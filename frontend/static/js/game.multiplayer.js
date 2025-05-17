import WebSocketFunWithFlags from "./game.websocket.js";
import MultiplayerGameController from "./game.multiplayercontroller.js";

const controller = new MultiplayerGameController();
new WebSocketFunWithFlags(controller.roomID, controller.username, controller);
