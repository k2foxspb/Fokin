let callBack = document.querySelector('#callback')
let callMsg = document.querySelector('#mess')
let myDiv = document.querySelector('#mydiv2')
let chatMessageSend = document.querySelector("#chatMessageSenddd");
let chatMessageInput = document.querySelector("#inputMsg");

chatMessageSend.onclick = function () {
    if (chatMessageInput.value.length === 0) return;
    chatSocket.send(JSON.stringify({
        "message": chatMessageInput.value,
    }));
    chatMessageInput.value = "";
};

// submit if the user presses the enter key
chatMessageInput.onkeyup = function(e) {
    if (e.keyCode === 13) {  // enter key
        chatMessageSend.click();
    }
};

function connect() {
    chatSocket = new WebSocket('ws://' + window.location.host + '/ws');
    chatSocket.onopen = function (e) {
        console.log("Successfully connected to the WebSocket.");
    }

    chatSocket.onclose = function (e) {
        console.log("WebSocket connection closed unexpectedly. Trying to reconnect in 2s...");
        setTimeout(function () {
            alert('связь прервана')
        }, 2000);
    };

    chatSocket.onmessage = function (event) {
        const data = JSON.parse(event.data);
        console.log(data)
        switch (data.type) {
            case "private_message":
                let now = new Date();
                myDiv.appendChild(myDivMess = document.createElement('div'))
                myDivMess.className += 'message'
                myDivMess.appendChild(myName = document.createElement('div'))
                myName.textContent += data.user + '\n';
                myDivMess.appendChild(myMessage = document.createElement('div'))
                myMessage.textContent += data.message
                myDivMess.appendChild(myDate = document.createElement('div'))
                myDate.className += 'date'
                myDate.textContent += data.time

                myDiv.scrollTop = myDiv.scrollHeight
                chatMessageInput.focus();
                break;

            case "user_join":
                myDiv.appendChild(myDivMess = document.createElement('div'))
                myDivMess.className = 'joinedTheRoom'
                myDivMess.textContent += data.user + " joined the room.\n";
                myDiv.scrollTop = myDiv.scrollHeight
                break;
            case "user_leave":
                myDiv.appendChild(myDivMess = document.createElement('div'))
                myDivMess.className = 'joinedTheRoom'
                myDivMess.textContent += data.user + " left the room.\n";

                break;
            // case "private_message":
            //     chatLog.textContent += "private_message from " + data.user + ": " + data.message + "\n";
            //     break;
            case "private_message_delivered":

                myDiv.appendChild(myDivMess = document.createElement('div'))
                myDivMess.className += 'message'
                myDivMess.appendChild( myName = document.createElement('div'))
                myName.textContent +=  data.user + '\n';
                myDivMess.appendChild( myMessage = document.createElement('div'))
                myMessage.textContent += "private_message to" + data.message
                myDivMess.appendChild( myDate = document.createElement('div'))
                myDate.className += 'date'
                myDate.textContent += data.time
                myDiv.appendChild(myDivMess = document.createElement('div'))
                break;
            default:
                console.error("Unknown message type!");
                break;
        }

        // scroll 'chatLog' to the bottom
        myDiv.scrollTop = myDiv.scrollHeight

    }
    document.addEventListener('mouseup', function (e) {

        if (!callMsg.contains(e.target)) {
            callMsg.style.display = 'none';
            callBack.style.display = 'block';
            chatSocket.close();
        }
    });
    chatSocket.onerror = function (err) {
        console.log("WebSocket encountered an error: " + err.message);
        console.log("Closing the socket.");
        chatSocket.close();
    }

}


callBack.onclick = function () {
    callBack.style.display = 'none';
    callMsg.style.display = 'block';
    chatMessageInput.focus()
    connect()
    myDiv.scrollTop = myDiv.scrollHeight
}
// клик не по элементу


