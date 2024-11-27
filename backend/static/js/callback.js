let callBack = document.querySelector('#callback')
let callMsg = document.querySelector('#mess')
let myDiv = document.querySelector('#mydiv2')
let chatMessageSend = document.querySelector("#chatMessageSenddd");
let chatMessageInput = document.querySelector("#inputMsg");

chatMessageSend.onclick = function () {
    if (chatMessageInput.value.length === 0) return;
    console.log('ушло')
    chatSocket.send(JSON.stringify({
        "message": chatMessageInput.value,
    }));
    chatMessageInput.value = "";
};

function connect() {
    chatSocket = new WebSocket('ws://' + window.location.host + '/ws');
    chatSocket.onopen = function (e) {
        console.log("Successfully connected to the WebSocket.");
    }

    chatSocket.onclose = function (e) {
        console.log("WebSocket connection closed unexpectedly. Trying to reconnect in 2s...");
        setTimeout(function () {
            console.log("Reconnecting...");
            connect();
        }, 2000);
    };

    chatSocket.onmessage = function (event) {
        let date = JSON.parse(event.data)
        try {
            console.log(date);
        } catch (e) {
            console.log('Error:', e.message)
        }
    }
    chatSocket.onerror = function (err) {
        console.log("WebSocket encountered an error: " + err.message);
        console.log("Closing the socket.");
        chatSocket.close();
    }

}

connect()


callBack.onclick = function () {
    callBack.style.display = 'none';
    callMsg.style.display = 'block';
    chatMessageInput.focus()
    myDiv.scrollTop = myDiv.scrollHeight
}
// клик не по элементу
document.addEventListener('mouseup', function (e) {

    if (!callMsg.contains(e.target)) {
        callMsg.style.display = 'none';
        callBack.style.display = 'block';
    }
});

