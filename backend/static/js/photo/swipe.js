const fullscreenImage = document.getElementById('fullscreen-image');
const threshold = 50;



let touchstartX = 0;
let touchendX = 0;

fullscreenImage.addEventListener('touchstart', (event) => {
    touchstartX = event.changedTouches[0].clientX;
}, { passive: true });

fullscreenImage.addEventListener('touchend', (event) => {
    touchendX = event.changedTouches[0].clientX;
    handleSwipe();
}, { passive: true });

function handleSwipe() {
    const diff = touchendX - touchstartX;
    if (Math.abs(diff) > threshold) {
        const direction = diff > 0 ? 'left' : 'right';
        animateSwipe(direction);
    }
}


function animateSwipe(direction) {
    fullscreenImage.classList.add(`swipe-${direction}`);
    fullscreenImage.style.opacity = 0;
    setTimeout(() => {
        const buttonToClick = direction === 'left' ? document.querySelector('.prev-button') : document.querySelector('.next-button');
        if (buttonToClick) {
            buttonToClick.click();
        }
        fullscreenImage.classList.remove(`swipe-${direction}`);
        fullscreenImage.style.opacity = 1;
    }, 300); // Время анимации в миллисекундах
}