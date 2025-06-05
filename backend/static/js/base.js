const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const notificationWebsocket = new WebSocket(`${wsProtocol}://${window.location.host}/${wsProtocol}/notification/`)
notificationWebsocket.onopen = async function (event) {
};
notificationWebsocket.onerror = function (error) {
    console.error('Notification WebSocket error:', error);
};
notificationWebsocket.onmessage = function (e) {
    const data = JSON.parse(e.data);

    if (data.type === 'initial_notification') {

        updateInitialCounts(data.unique_sender_count, data.messages[1]);
    } else if (data.type === 'messages_by_sender_update') {

        updateCounts(data.messages[1]);
        updateInitialCounts(data.unique_sender_count, data.messages[1]);
    }
};

function updateInitialCounts(uniqueSenderCount, messages) {
    // Обновляем общий счётчик непрочитанных сообщений
    const unreadCountElement = document.getElementById("unread-counttt");
    if (unreadCountElement) {
        unreadCountElement.textContent = uniqueSenderCount;
        unreadCountElement.style.display = uniqueSenderCount > 0 ? 'inline' : 'none';
    }
    // Обновляем счётчики для каждого отправителя
    messages.forEach(message => {
        updateSenderCount(message.sender_id, message.count);
    });
}

function updateCounts(messages) {
    messages.forEach(message => {
        updateSenderCount(message.sender_id, message.count);
    });

}


function updateSenderCount(senderId, count) {
    const senderCountElement = document.getElementById(`sender-${senderId}-count`);
    if (senderCountElement) {
        senderCountElement.textContent = count;
        senderCountElement.style.display = count > 0 ? 'inline' : 'none';
    }
}


function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: #670000;
      color: #fff;
      padding: 10px;
      border-radius: 5px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        document.body.removeChild(notification);
    }, 3000);
}
