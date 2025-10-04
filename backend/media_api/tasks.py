from celery import shared_task
from django.core.cache import cache
from django.core.files.base import ContentFile
from PIL import Image
import subprocess
import os
import logging
from .models import VideoFile, ImageFile, UploadedFile

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def compress_video_task(self, video_file_id):
    """
    Фоновое сжатие видео с использованием FFmpeg для оптимальной передачи.
    Использует H.264 кодек с оптимизированными параметрами для web-стриминга.
    """
    try:
        video = VideoFile.objects.get(id=video_file_id)

        logger.info(f'🚀 [CELERY] Starting turbo video compression for file {video_file_id}')

        input_path = video.file.path
        output_filename = f'compressed_{os.path.basename(input_path)}'
        output_path = os.path.join(os.path.dirname(input_path), output_filename)

        # Турбо-сжатие с H.264 для максимальной совместимости и скорости
        compress_cmd = [
            'ffmpeg',
            '-i', input_path,
            '-c:v', 'libx264',  # H.264 кодек
            '-preset', 'veryfast',  # Быстрое кодирование
            '-crf', '23',  # Оптимальное качество/размер
            '-c:a', 'aac',  # AAC аудио кодек
            '-b:a', '128k',  # Битрейт аудио
            '-movflags', '+faststart',  # Оптимизация для стриминга
            '-pix_fmt', 'yuv420p',  # Совместимость с большинством плееров
            '-max_muxing_queue_size', '1024',  # Увеличенная очередь
            '-y',  # Перезаписать без подтверждения
            output_path
        ]

        result = subprocess.run(
            compress_cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 минут таймаут
        )

        if result.returncode == 0 and os.path.exists(output_path):
            # Проверяем размер сжатого файла
            original_size = os.path.getsize(input_path)
            compressed_size = os.path.getsize(output_path)
            compression_ratio = (1 - compressed_size / original_size) * 100

            logger.info(f'🚀 [CELERY] Video compressed: {compression_ratio:.1f}% reduction')

            # Если сжатие эффективно (больше 10% экономии), заменяем файл
            if compression_ratio > 10:
                # Удаляем оригинал и переименовываем сжатый
                os.remove(input_path)
                os.rename(output_path, input_path)

                # Обновляем размер в БД
                video.file_size = compressed_size
                video.save(update_fields=['file_size'])

                # Инвалидируем кэш для этого файла
                cache_key = f'media_url_{video_file_id}'
                cache.delete(cache_key)

                logger.info(f'🚀 [CELERY] ✅ Video compression completed successfully')
            else:
                # Сжатие неэффективно, оставляем оригинал
                os.remove(output_path)
                logger.info(f'🚀 [CELERY] Compression ratio too low, keeping original')
        else:
            logger.error(f'🚀 [CELERY] FFmpeg compression failed: {result.stderr}')
            raise Exception(f'FFmpeg failed: {result.stderr}')

    except VideoFile.DoesNotExist:
        logger.error(f'🚀 [CELERY] Video file {video_file_id} not found')
    except subprocess.TimeoutExpired:
        logger.error(f'🚀 [CELERY] Video compression timeout for {video_file_id}')
        raise self.retry(countdown=60)
    except Exception as e:
        logger.error(f'🚀 [CELERY] Error compressing video: {e}')
        raise self.retry(exc=e, countdown=60)


@shared_task
def generate_video_thumbnail_task(video_file_id):
    """
    Генерация превью для видео.
    """
    try:
        video = VideoFile.objects.get(id=video_file_id)

        logger.info(f'🎬 [CELERY] Generating thumbnail for video {video_file_id}')

        input_path = video.file.path
        thumbnail_filename = f'thumb_{video_file_id}.jpg'
        thumbnail_path = os.path.join(os.path.dirname(input_path), thumbnail_filename)

        # Генерируем превью на 1 секунде видео
        thumbnail_cmd = [
            'ffmpeg',
            '-i', input_path,
            '-ss', '00:00:01.000',  # 1 секунда
            '-vframes', '1',  # Один кадр
            '-vf', 'scale=640:-1',  # Масштабирование до 640px ширины
            '-y',
            thumbnail_path
        ]

        result = subprocess.run(
            thumbnail_cmd,
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0 and os.path.exists(thumbnail_path):
            logger.info(f'🎬 [CELERY] ✅ Thumbnail generated successfully')

            # Сохраняем путь к превью (если есть соответствующее поле в модели)
            if hasattr(video, 'thumbnail'):
                with open(thumbnail_path, 'rb') as f:
                    video.thumbnail.save(thumbnail_filename, ContentFile(f.read()), save=True)
                os.remove(thumbnail_path)
        else:
            logger.error(f'🎬 [CELERY] Thumbnail generation failed: {result.stderr}')

    except Exception as e:
        logger.error(f'🎬 [CELERY] Error generating thumbnail: {e}')


@shared_task
def optimize_image_task(image_file_id):
    """
    Оптимизация изображения для быстрой загрузки.
    """
    try:
        image_file = ImageFile.objects.get(id=image_file_id)

        logger.info(f'🖼️ [CELERY] Optimizing image {image_file_id}')

        img_path = image_file.file.path

        with Image.open(img_path) as img:
            # Конвертируем в RGB если необходимо
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')

            # Масштабируем если изображение очень большое
            max_dimension = 2048
            if img.width > max_dimension or img.height > max_dimension:
                img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
                logger.info(f'🖼️ [CELERY] Image resized to fit {max_dimension}px')

            # Сохраняем с оптимизацией
            img.save(img_path, 'JPEG', quality=85, optimize=True, progressive=True)

        # Обновляем размер файла
        new_size = os.path.getsize(img_path)
        original_size = image_file.file_size
        reduction = (1 - new_size / original_size) * 100 if original_size > 0 else 0

        image_file.file_size = new_size
        image_file.save(update_fields=['file_size'])

        # Инвалидируем кэш
        cache_key = f'media_url_{image_file_id}'
        cache.delete(cache_key)

        logger.info(f'🖼️ [CELERY] ✅ Image optimized: {reduction:.1f}% size reduction')

    except Exception as e:
        logger.error(f'🖼️ [CELERY] Error optimizing image: {e}')


@shared_task
def prefetch_media_urls_task(message_ids):
    """
    Предварительное кэширование URL медиафайлов для быстрого доступа.
    """
    try:
        from chatapp.models import Message, PrivateMessage

        logger.info(f'⚡ [CELERY] Prefetching media URLs for {len(message_ids)} messages')

        cached_count = 0

        for message_id in message_ids:
            try:
                # Ищем сообщение
                message = None
                try:
                    message = Message.objects.get(id=message_id)
                except Message.DoesNotExist:
                    try:
                        message = PrivateMessage.objects.get(id=message_id)
                    except PrivateMessage.DoesNotExist:
                        continue

                if not message:
                    continue

                # Получаем медиафайл
                uploaded_file = None
                if hasattr(message, 'media_file') and message.media_file:
                    uploaded_file = message.media_file

                if uploaded_file:
                    # Кэшируем URL на 1 час
                    cache_key = f'media_url_{message_id}'
                    file_data = {
                        'file_id': uploaded_file.id,
                        'file_type': uploaded_file.file_type,
                        'file_url': uploaded_file.file.url,
                        'original_name': uploaded_file.original_name,
                        'size': uploaded_file.file_size,
                        'mime_type': uploaded_file.mime_type,
                    }

                    cache.set(cache_key, file_data, timeout=3600)  # 1 час
                    cached_count += 1

            except Exception as msg_error:
                logger.error(f'⚡ [CELERY] Error prefetching message {message_id}: {msg_error}')
                continue

        logger.info(f'⚡ [CELERY] ✅ Prefetched {cached_count} media URLs')

    except Exception as e:
        logger.error(f'⚡ [CELERY] Error in prefetch task: {e}')


@shared_task
def cleanup_old_cache_task():
    """
    Периодическая очистка устаревшего кэша.
    Можно запускать через Celery Beat каждые несколько часов.
    """
    try:
        logger.info('🧹 [CELERY] Starting cache cleanup')

        # Redis не требует явной очистки - TTL автоматически удаляет ключи
        # Здесь можно добавить дополнительную логику если необходимо

        logger.info('🧹 [CELERY] ✅ Cache cleanup completed')

    except Exception as e:
        logger.error(f'🧹 [CELERY] Error during cache cleanup: {e}')
