# backend/media_api/tasks.py
import os
import subprocess
import logging
import tempfile

from celery import shared_task
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image

from .models import VideoFile, ImageFile, UploadedFile

logger = logging.getLogger(__name__)


# -------------------------------------------------------------------------
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# -------------------------------------------------------------------------
def _download_to_temp(field_file):
    """
    Скачивает Django FieldFile в реальный локальный файл.
    Возвращает путь к временному файлу.
    Файл НЕ удаляется – это делает вызывающий код.
    """
    # Создаём временный файл с тем же расширением, чтобы ffmpeg / PIL "поняли" тип
    suffix = os.path.splitext(field_file.name)[1] or ''
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        for chunk in field_file.chunks():
            tmp.write(chunk)
        tmp.flush()
        return tmp.name
    finally:
        tmp.close()


def _save_back_to_field(field_file, local_path, original_name=None):
    """
    Загружает локальный файл обратно в Django FieldFile.
    Если передан original_name – переименовываем объект в хранилище.
    """
    with open(local_path, 'rb') as f:
        content = ContentFile(f.read())
        # Если имя менять не нужно – просто .save() заменит содержимое
        if original_name:
            field_file.save(original_name, content, save=True)
        else:
            field_file.save(field_file.name, content, save=True)


# -------------------------------------------------------------------------
# 1️⃣ Компрессия видео
# -------------------------------------------------------------------------
@shared_task(bind=True, max_retries=3)
def compress_video_task(self, video_file_id):
    """
    Фоновое сжатие видео через FFmpeg.
    Поддерживает любые back‑ends (S3, GCS, локальное FS и т.п.).
    """
    try:
        video = VideoFile.objects.get(id=video_file_id)
        logger.info(f'🚀 [CELERY] Starting turbo video compression for file {video_file_id}')

        # ---- скачиваем в локальный файл ----
        input_path = _download_to_temp(video.file)

        # ---- формируем путь для выходного файла ----
        base_dir, base_name = os.path.split(input_path)
        output_filename = f'compressed_{base_name}'
        output_path = os.path.join(base_dir, output_filename)
        vf = (
            # 1) Приводим к максимуму 1280×720, сохраняем aspect‑ratio
            "scale='if(gt(iw,1280),1280,iw)':'if(gt(ih,720),720,ih)',"
            # 2) Делаем обе стороны чётными
            "scale=trunc(iw/2)*2:trunc(ih/2)*2"
        )
        # ---- команда ffmpeg ----
        compress_cmd = [
            'ffmpeg',
            '-y',
            '-i', input_path,
            '-c:v', 'libx264',
            '-profile:v', 'baseline',
            '-level', '3.0',
            '-preset', 'veryfast',
            '-crf', '23',
            '-vf', vf,
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-movflags', '+faststart',
            '-pix_fmt', 'yuv420p',
            '-max_muxing_queue_size', '1024',
            '-y',
            output_path
        ]

        result = subprocess.run(
            compress_cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 мин – максимум для видеокомпрессии
        )

        # ---- проверяем результат ----
        if result.returncode == 0 and os.path.exists(output_path):
            original_size = os.path.getsize(input_path)
            compressed_size = os.path.getsize(output_path)
            compression_ratio = (1 - compressed_size / original_size) * 100

            logger.info(f'🚀 [CELERY] Video compressed: {compression_ratio:.1f}% reduction')

            if compression_ratio > 10:  # экономия более 10 %
                # заменяем оригинал новым файлом
                _save_back_to_field(video.file, output_path, original_name=video.file.name)
                video.file_size = compressed_size
                video.save(update_fields=['file_size'])

                # очистка кеша
                cache_key = f'media_url_{video_file_id}'
                cache.delete(cache_key)

                logger.info('🚀 [CELERY] ✅ Video compression completed successfully')
            else:
                logger.info('🚀 [CELERY] Compression ratio too low – original file kept')
        else:
            logger.error(f'🚀 [CELERY] FFmpeg failed: {result.stderr}')
            raise Exception(f'FFmpeg failed: {result.stderr}')

    except VideoFile.DoesNotExist:
        logger.error(f'🚀 [CELERY] Video file {video_file_id} not found')
    except subprocess.TimeoutExpired:
        logger.error(f'🚀 [CELERY] Video compression timeout for {video_file_id}')
        raise self.retry(countdown=60)
    except Exception as exc:
        logger.error(f'🚀 [CELERY] Error compressing video {video_file_id}: {exc}')
        raise self.retry(exc=exc, countdown=60)
    finally:
        # Удаляем временные файлы независимо от успеха/ошибки
        for p in (locals().get('input_path'), locals().get('output_path')):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


# -------------------------------------------------------------------------
# 2️⃣ Генерация миниатюры видео
# -------------------------------------------------------------------------
@shared_task
def generate_video_thumbnail_task(video_file_id):
    """
    Генерирует превью‑кадр (1‑й секунды) из видео.
    Работает с любым бекендом файлов.
    """
    try:
        video = VideoFile.objects.get(id=video_file_id)
        logger.info(f'🎬 [CELERY] Generating thumbnail for video {video_file_id}')

        input_path = _download_to_temp(video.file)

        # Путь к временной миниатюре
        thumb_path = os.path.join(
            os.path.dirname(input_path),
            f'thumb_{video_file_id}.jpg'
        )

        thumb_cmd = [
            'ffmpeg',
            '-i', input_path,
            '-ss', '00:00:01.000',
            '-vframes', '1',
            '-vf', 'scale=640:-1',
            '-y',
            thumb_path
        ]

        result = subprocess.run(
            thumb_cmd,
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0 and os.path.exists(thumb_path):
            logger.info('🎬 [CELERY] ✅ Thumbnail generated')

            # Если у модели VideoFile есть поле `thumbnail`
            if hasattr(video, 'thumbnail'):
                with open(thumb_path, 'rb') as f:
                    video.thumbnail.save(
                        os.path.basename(thumb_path),
                        ContentFile(f.read()),
                        save=True
                    )
        else:
            logger.error(f'🎬 [CELERY] Thumbnail generation failed: {result.stderr}')

    except VideoFile.DoesNotExist:
        logger.error(f'🎬 [CELERY] Video file {video_file_id} not found')
    except subprocess.TimeoutExpired:
        logger.error(f'🎬 [CELERY] Thumbnail generation timeout for {video_file_id}')
    except Exception as exc:
        logger.error(f'🎬 [CELERY] Error generating thumbnail: {exc}')
    finally:
        # Очистка временных файлов
        for p in (locals().get('input_path'), locals().get('thumb_path')):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


# -------------------------------------------------------------------------
# 3️⃣ Оптимизация изображения
# -------------------------------------------------------------------------
@shared_task
def optimize_image_task(image_file_id):
    """
    Оптимизирует изображение (уменьшение размеров, повышение компрессии).
    Поддерживает любые бекенды.
    """
    try:
        image_file = ImageFile.objects.get(id=image_file_id)
        logger.info(f'🖼️ [CELERY] Optimizing image {image_file_id}')

        # Скачиваем в локальный файл
        img_path = _download_to_temp(image_file.file)

        with Image.open(img_path) as img:
            # Приводим к RGB (для JPEG)
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')

            # Ограничиваем максимальное измерение
            max_dimension = 2048
            if img.width > max_dimension or img.height > max_dimension:
                img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
                logger.info(f'🖼️ [CELERY] Image resized to ≤{max_dimension}px')

            # Сохраняем с оптимизацией JPEG
            img.save(img_path, 'JPEG', quality=85, optimize=True, progressive=True)

        # Обновляем размер в базе
        new_size = os.path.getsize(img_path)
        image_file.file_size = new_size
        image_file.save(update_fields=['file_size'])

        # Сохраняем (перезаписываем) файл в хранилище
        _save_back_to_field(image_file.file, img_path)

        # Инвалидация кеша
        cache_key = f'media_url_{image_file_id}'
        cache.delete(cache_key)

        reduction = (1 - new_size / image_file.file_size) * 100 if image_file.file_size else 0
        logger.info(f'🖼️ [CELERY] ✅ Image optimized, size reduced by {reduction:.1f}%')

    except ImageFile.DoesNotExist:
        logger.error(f'🖼️ [CELERY] Image file {image_file_id} not found')
    except Exception as exc:
        logger.error(f'🖼️ [CELERY] Error optimizing image: {exc}')
    finally:
        # Очистка временного файла
        if locals().get('img_path') and os.path.exists(img_path):
            try:
                os.remove(img_path)
            except OSError:
                pass


# -------------------------------------------------------------------------
# 4️⃣ Предзагрузка URL‑ов медиа
# -------------------------------------------------------------------------
@shared_task
def prefetch_media_urls_task(message_ids):
    """
    Кеширует URL‑ы медиафайлов (для быстрого доступа в UI).
    """
    try:
        from chatapp.models import Message, PrivateMessage

        logger.info(f'⚡ [CELERY] Prefetching media URLs for {len(message_ids)} messages')
        cached = 0

        for msg_id in message_ids:
            try:
                # Попытка получить сообщение (публичное или приватное)
                try:
                    message = Message.objects.get(id=msg_id)
                except Message.DoesNotExist:
                    message = PrivateMessage.objects.get(id=msg_id)
            except Exception:
                continue

            uploaded = getattr(message, 'media_file', None)
            if not uploaded:
                continue

            cache_key = f'media_url_{msg_id}'
            cache.set(
                cache_key,
                {
                    'file_id': uploaded.id,
                    'file_type': uploaded.file_type,
                    'file_url': uploaded.file.url,
                    'original_name': uploaded.original_name,
                    'size': uploaded.file_size,
                    'mime_type': uploaded.mime_type,
                },
                timeout=3600  # 1 час
            )
            cached += 1

        logger.info(f'⚡ [CELERY] ✅ Prefetched {cached} media URLs')
    except Exception as exc:
        logger.error(f'⚡ [CELERY] Error in prefetch task: {exc}')


# -------------------------------------------------------------------------
# 5️⃣ Очистка старого кеша (периодическая)
# -------------------------------------------------------------------------
@shared_task
def cleanup_old_cache_task():
    """
    Если вы используете Redis‑кеш, TTL автоматически удаляет ключи.
    Эта задача оставлена как «затычка», если в дальнейшем понадобится
    кастомная очистка (например, удаление «зависших» ключей).
    """
    try:
        logger.info('🧹 [CELERY] Starting cache cleanup')
        # Здесь можно добавить свою логику, если понадобится.
        logger.info('🧹 [CELERY] ✅ Cache cleanup completed')
    except Exception as exc:
        logger.error(f'🧹 [CELERY] Error during cache cleanup: {exc}')
