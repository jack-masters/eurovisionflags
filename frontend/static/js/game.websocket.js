class WebSocketFunWithFlags {
  constructor(roomID, username, controller) {
    this.roomID = roomID;
    this.username = username;
    this.controller = controller;
    this.socket = null;

    this.controller.socket = this.openWebSocketConnection();
  }

  handleWebSocketMessage(event) {
    const message = JSON.parse(event.data);
    switch (message.event) {
      case "playerJoined":
        this.controller.addPlayer(message.data.id, message.data.username);
        this.controller.updatePlayerCount();
        break;
      case "playerLeft":
        this.controller.removePlayer(message.data.id, message.data.username);
        this.controller.updatePlayerCount();
        break;
      case "countdown":
        this.controller.hidewaitingroom();
        this.renderCountdown(message.data);
        break;
      case "gameStarted":
        console.log("Game started");
        this.controller.startGame();
        this.controller.requestQuestion(0);
        break;
      case "new_question":
        // When the client requests the question from the backend
        // it is returned in this event.
        this.controller.updateCurrentQuestion(message.data);
        this.controller.loadQuestion();
        break;
      case "answer_result":
        // When user sends a validate_answer event
        // response is returned in this event
        // returns the choosen answer and correct answer
        this.controller.verifyAnswer(message.data);
        break;
      case "score":
        // When a user answers correctly, the backend
        // broadcasts score event to the entire room
        // so that all clients leaderboards gets updated
        this.controller.scoreUpdate(message.data);
        break;
      case "finished_game":
        this.controller.finishGame(message.username);
        break;
      case "time_over":
        // When the game has ended, time over event is
        // send from the server and then it alerts the user that the game has ended.
        this.controller.timeover();
        break;
      case "all_players_finished":
        // This is the end point and this is when the game finished
        // and the websocket connections are erased after this point
        this.controller.endgame();
        break;
      default:
        console.warn("Unhandled WebSocket event:", message.event);
    }
  }

  renderCountdown(count) {
    const countdownSection =
      document.querySelector(".countdown-container") ||
      document.createElement("section");

    if (!document.body.contains(countdownSection)) {
      countdownSection.className = "countdown-container";
      const textElement = document.createElement("p");
      textElement.textContent = "The game begins in";
      countdownSection.appendChild(textElement);

      const numberElement = document.createElement("h2");
      numberElement.className = "countdown-number";
      countdownSection.appendChild(numberElement);

      document.body.appendChild(countdownSection);
    }

    const numberElement = countdownSection.querySelector(".countdown-number");
    if (count === 0) {
      numberElement.textContent = "START!";
      setTimeout(() => countdownSection.remove(), 1000);
    } else {
      numberElement.textContent = count;
    }
  }

  openWebSocketConnection() {
    const WS_BASE_URL = `wss://${window.location.host}/ws`;
    const socket = new WebSocket(WS_BASE_URL);

    socket.onopen = () => {
      console.log("WebSocket connection established.");
      socket.send(
        JSON.stringify({
          event: "joinRoom",
          username: this.username,
          roomID: this.roomID,
        }),
      );
    };

    socket.onmessage = this.handleWebSocketMessage.bind(this);

    socket.onclose = () => {
      console.log("WebSocket connection closed.");
    };

    return socket;
  }
}

export default WebSocketFunWithFlags;
