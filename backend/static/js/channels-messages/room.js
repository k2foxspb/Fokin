// console.log("Sanity check from room.js.");

const roomName = JSON.parse(document.getElementById('roomName').textContent);

let chatMessageInput = document.querySelector("#chatMessageInput");
let chatMessageSend = document.querySelector("#chatMessageSend");
let onlineUsersSelector = document.querySelector("#onlineUsersSelector");
let myDiv = document.querySelector('#mydiv')
let myDivMess;
let myName;
let myMessage;
let myDate

// adds a new option to 'onlineUsersSelector'
function onlineUsersSelectorAdd(value) {

    let newOption = document.createElement("div");
    newOption.textContent = value;
    newOption.id = 'user_id_' + value
    newOption.innerHTML = value;
    onlineUsersSelector.appendChild(newOption);
}

// removes an option from 'onlineUsersSelector'
function onlineUsersSelectorRemove(value) {
    let oldOption = document.querySelector("#user_id_"+ value);
    if (oldOption !== null) oldOption.remove();
}

// focus 'chatMessageInput' when user opens the page
chatMessageInput.focus();

// submit if the user presses the enter key
chatMessageInput.onkeyup = function(e) {
    if (e.keyCode === 13) {  // enter key
        chatMessageSend.click();
    }
};

// clear the 'chatMessageInput' and forward the message
chatMessageSend.onclick = function() {
    if (chatMessageInput.value.length === 0) return;
    chatSocket.send(JSON.stringify({
        "message": chatMessageInput.value,
    }));
    chatMessageInput.value = "";
};

let chatSocket = null;

function connect() {
    chatSocket = new WebSocket("wss://" + window.location.host + "/wss/chat/" + roomName + "/");
    console.log(chatSocket)
    chatSocket.onopen = function(e) {
        console.log("Successfully connected to the WebSocket.");
    }

    chatSocket.onclose = function(e) {
        console.log("WebSocket connection closed unexpectedly. Trying to reconnect in 2s...");
        setTimeout(function() {
            console.log("Reconnecting...");
            connect();
        }, 2000);
    };

    chatSocket.onmessage = function(e) {
        const data = JSON.parse(e.data);
        console.log(data);

        switch (data.type) {
            case "chat_message":
                let now = new Date();
                myDiv.appendChild( myDivMess = document.createElement('div'))
                myDivMess.className += 'message'
                myDivMess.appendChild( myName = document.createElement('div'))
                myName.textContent +=  data.user + '\n';
                myDivMess.appendChild( myMessage = document.createElement('div'))
                myMessage.textContent += data.message
                myDivMess.appendChild( myDate = document.createElement('div'))
                myDate.className += 'date'
                myDate.textContent += data.time

                myDiv.scrollTop = myDiv.scrollHeight
                chatMessageInput.focus();
                break;

            case "user_list":
                for (let i = 0; i < data.users.length; i++) {
                    onlineUsersSelectorAdd(data.users[i]);
                }
                break;
            case "user_join":
                myDiv.appendChild( myDivMess = document.createElement('div'))
                myDivMess.className = 'joinedTheRoom'
                myDivMess.textContent += data.user + " joined the room.\n";
                myDiv.scrollTop = myDiv.scrollHeight
                onlineUsersSelectorAdd(data.user);
                break;
            case "user_leave":
                myDiv.appendChild(myDivMess = document.createElement('div'))
                myDivMess.className = 'joinedTheRoom'
                myDivMess.textContent += data.user + " left the room.\n";
                onlineUsersSelectorRemove(data.user);
                break;
            case "private_message":
                chatLog.textContent += "private_message from " + data.user + ": " + data.message + "\n";
                break;
            case "private_message_delivered":
                chatLog.textContent += "private_message to " + data.target + ": " + data.message + "\n";
                break;
            default:
                console.error("Unknown message type!");
                break;
        }

        // scroll 'chatLog' to the bottom
        myDiv.scrollTop = myDiv.scrollHeight
    };

    chatSocket.onerror = function(err) {
        console.log("WebSocket encountered an error: " + err.message);
        console.log("Closing the socket.");
        chatSocket.close();
    }
}
connect();

onlineUsersSelector.onchange = function() {
    chatMessageInput.value = "/pm " + onlineUsersSelector.value + " ";
    onlineUsersSelector.value = null;
    chatMessageInput.focus();
};