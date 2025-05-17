package internals

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/adimail/fun-with-flags/internals/game"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for simplicity
	},
}

// HandleWebSocket manages WebSocket connections for a multiplayer game room.
// It handles the initial connection setup, player registration, and ongoing
// communication between players in a room. The function supports various game
// events including player joins, answers, score updates, and departures.
//
// The function expects an initial message containing:
//   - Username: The display name of the connecting player
//   - RoomID: The unique identifier of the game room to join
//
// It enforces a maximum of 9 players per room and manages the following events:
//   - "leave": Handle explicit player departure
//   - "loadgame": Initialize game countdown and start
//   - "get_new_question": Send a new question to the requesting player
//   - "validate_answer": Validate a submitted answer and send the response to the player, broadcasting score updates if correct
//
// Parameters:
//   - w: The HTTP response writer
//   - r: The HTTP request containing the WebSocket upgrade request
//
// The connection is automatically closed when the function returns.
func HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket Upgrade error:", err)
		http.Error(w, "Could not open WebSocket connection", http.StatusInternalServerError)
		return
	}

	defer conn.Close()

	var initialMessage struct {
		Username string `json:"username"`
		RoomID   string `json:"roomID"`
	}
	if err := conn.ReadJSON(&initialMessage); err != nil {
		log.Println("Failed to read initial message:", err)
		conn.WriteJSON(map[string]string{"error": "Invalid initial message"})
		return
	}

	room, exists := rooms[initialMessage.RoomID]

	if !exists {
		conn.WriteJSON(map[string]string{"error": "Room not found"})
		return
	}

	if len(room.Players) >= 9 {
		conn.WriteJSON(map[string]string{"error": "Room is full, only 9 members can join in one room"})
		return
	}

	// Create a new player instance
	player := &game.Player{
		ID:        generatePlayerID(),
		Username:  initialMessage.Username,
		Score:     0,
		Completed: false,
		Conn:      conn,
	}

	// Add the player to the room's Players map
	room.Players[conn] = player

	// Notify all players about the new player
	broadcastToRoom(room, map[string]interface{}{
		"event": "playerJoined",
		"data": map[string]interface{}{
			"username": player.Username,
			"score":    player.Score,
			"id":       player.ID,
		},
	})

	// WebSocket communication loop
	for {
		var message struct {
			Event string      `json:"event"`
			Data  interface{} `json:"data"`
		}

		err := conn.ReadJSON(&message)
		if err != nil {
			log.Printf("WebSocket connection closed for player %s: %v", player.Username, err)
			break
		}

		switch message.Event {
		case "leave":
			log.Printf("Player %s left the room", player.Username)
			removePlayerFromRoom(initialMessage.RoomID, room, conn, player)
			return

		case "loadgame":
			for i := 3; i >= 0; i-- {
				broadcastToRoom(room, map[string]interface{}{
					"event": "countdown",
					"data":  i,
				})
				time.Sleep(1 * time.Second)
			}

			room.Start = true

			broadcastToRoom(room, map[string]interface{}{
				"event": "gameStarted",
			})

			go func(room *game.Room) {
				time.Sleep(time.Duration(room.TimeLimit) * time.Minute)

				broadcastToRoom(room, map[string]interface{}{
					"event": "time_over",
				})

				for conn := range room.Players {
					conn.Close()
				}

				delete(rooms, room.Code)
			}(room)

		case "get_new_question":
			// When a client sends this event, it will send the question index for the question
			// and this is handeled by returning the room.Questions[requetedindex] question
			//
			// This event sends the requested question to the client which requested it using conn.WriteJSON
			var questionNumber int

			if dataMap, ok := message.Data.(map[string]interface{}); ok {
				if questionNumberFloat, ok := dataMap["question_number"].(float64); ok {
					questionNumber = int(questionNumberFloat)
				} else {
					log.Println("Invalid question_number type")
					conn.WriteJSON(map[string]string{"error": "Invalid question number"})
					continue
				}
			} else {
				log.Println("Invalid data format for get_new_question")
				conn.WriteJSON(map[string]string{"error": "Invalid data format"})
				continue
			}

			question, err := getQuestion(room, questionNumber)
			if err != nil {
				log.Println("Failed to get question:", err)
				conn.WriteJSON(map[string]string{"error": "Failed to get question"})
				continue
			}

			err = conn.WriteJSON(map[string]interface{}{
				"event": "new_question",
				"data":  question,
			})
			if err != nil {
				log.Println("Error sending question to player:", err)
			}

		case "clean_room":
			// After all players have finished the game, the memory
			// is cleared and all room and player instances are erased
			if allPlayersCompleted(room) {
				for conn := range room.Players {
					conn.Close()
				}

				delete(rooms, initialMessage.RoomID)
			}

		case "validate_answer":
			// This WebSocket event handles answer validation for a quiz or game.
			// It receives the question index and the player's chosen answer from the client
			// and delegates validation to the backend.
			var rawData map[string]interface{}
			rawData, ok := message.Data.(map[string]interface{})
			if !ok {
				log.Println("Invalid data type for validate_answer")
				conn.WriteJSON(map[string]string{"error": "Invalid data format"})
				continue
			}

			data := struct {
				QuestionIndex int    `json:"question_index"`
				Answer        string `json:"answer"`
			}{}

			if questionIndex, ok := rawData["question_index"].(float64); ok {
				data.QuestionIndex = int(questionIndex)
			} else {
				conn.WriteJSON(map[string]string{"error": "Invalid question index"})
				continue
			}

			if answer, ok := rawData["answer"].(string); ok {
				data.Answer = answer
			} else {
				conn.WriteJSON(map[string]string{"error": "Invalid answer"})
				continue
			}

			if data.QuestionIndex < 0 || data.QuestionIndex >= len(room.Questions) {
				conn.WriteJSON(map[string]string{"error": "Invalid question index"})
				continue
			}

			question := room.Questions[strconv.Itoa(data.QuestionIndex)]
			isCorrect := question.Answer == data.Answer

			messageResponse := map[string]interface{}{
				"event": "answer_result",
				"data": map[string]interface{}{
					"correct_answer": question.Answer,
					"chosen_answer":  data.Answer,
				},
			}

			err := conn.WriteJSON(messageResponse)
			if err != nil {
				log.Println("Error sending validation response to player:", err)
			}

			if isCorrect {
				player.Score++
				broadcastToRoom(room, map[string]interface{}{
					"event": "score",
					"data": map[string]interface{}{
						"username": player.Username,
						"score":    player.Score,
					},
				})
			}

			if data.QuestionIndex+1 == len(room.Questions) {
				player.Completed = true
				broadcastToRoom(room, map[string]interface{}{
					"event":    "finished_game",
					"username": player.Username,
				})

				if allPlayersCompleted(room) {
					broadcastToRoom(room, map[string]interface{}{
						"event": "all_players_finished",
					})
				}

			}

		}
	}

	removePlayerFromRoom(initialMessage.RoomID, room, conn, player)
}

// removePlayerFromRoom removes a player from a game room and performs necessary cleanup.
// It handles both explicit departures and implicit disconnections. If the room becomes
// empty after removal, it will also delete the room from the global rooms map.
//
// Parameters:
//   - roomID: The unique identifier of the room
//   - room: Pointer to the Room instance
//   - conn: The WebSocket connection to be removed
//   - player: The Player instance to be removed
//
// The function performs the following operations:
//   - Removes the player from the room's Players map
//   - Notifies remaining players about the departure
//   - Cleans up empty rooms
//   - Handles thread-safe access to shared resources
func removePlayerFromRoom(roomID string, room *game.Room, conn *websocket.Conn, player *game.Player) {
	delete(room.Players, conn)
	remainingPlayers := len(room.Players)

	// Notify remaining players
	broadcastToRoom(room, map[string]interface{}{
		"event": "playerLeft",
		"data": map[string]interface{}{
			"username": player.Username,
			"id":       player.ID,
		},
	})

	if remainingPlayers == 0 {
		delete(rooms, roomID)
		log.Printf("Room %s has been closed.", roomID)
	}
}

// broadcastToRoom sends a message to all players in a specified room.
// It safely handles concurrent access to the room's player list and manages
// failed message deliveries by removing disconnected players.
//
// Parameters:
//   - room: Pointer to the Room instance
//   - message: The message to broadcast (will be JSON encoded)
//
// The function:
//   - Acquires the room mutex to ensure thread-safe access
//   - Attempts to send the message to each connected player
//   - Handles failed sends by closing connections and removing players
func broadcastToRoom(room *game.Room, message interface{}) {
	for conn, player := range room.Players {
		if err := conn.WriteJSON(message); err != nil {
			log.Printf("Error broadcasting message to player %s: %v", player.Username, err)
			conn.Close()
			delete(room.Players, conn)
		}
	}
}

// sendToPlayer sends a message to a specific player in a room.
// It provides targeted communication instead of broadcasting to all players.
// The function handles thread-safe access and connection cleanup if needed.
//
// Parameters:
//   - room: Pointer to the Room instance
//   - playerID: The unique identifier of the target player
//   - message: The message to send (will be JSON encoded)
//
// Returns:
//   - error: nil if successful, error if player not found or message send fails
//
// The function:
//   - Safely accesses the room's player list
//   - Locates the specific player by ID
//   - Handles message delivery failures
//   - Cleans up failed connections
//   - Provides detailed error information
func sendToPlayer(room *game.Room, playerID string, message interface{}) error {
	var targetConn *websocket.Conn
	var targetPlayer *game.Player

	for conn, player := range room.Players {
		if player.ID == playerID {
			targetConn = conn
			targetPlayer = player
			break
		}
	}

	if targetConn == nil {
		return fmt.Errorf("player with ID %s not found in room", playerID)
	}

	if err := targetConn.WriteJSON(message); err != nil {
		log.Printf("Error sending message to player %s: %v", targetPlayer.Username, err)
		targetConn.Close()
		delete(room.Players, targetConn)
		return err
	}

	return nil
}

// getQuestion retrieves a specific question from a game room.
//
// It takes the following arguments:
//   - room: Pointer to the game.Room struct representing the game room
//   - questionNumber: The index of the question to retrieve (zero-based)
//
// The function returns a map containing the question data and an error if:
//   - The provided room pointer is nil
//   - The room has no questions
//   - The question number is negative
//   - The question number is out of range (greater than or equal to the total number of questions)
//   - The question with the specified number is not found in the room
//
// Behavior:
//   - If the room's GameMode is "mcq", the returned map includes the question's options and flag URL.
//   - For other game modes, the map contains only the flag URL.
//
// Example return values:
//   - For MCQ mode: {"options": [...], "flag_url": "..."}
//   - For non-MCQ mode: {"flag_url": "..."}
func getQuestion(room *game.Room, questionNumber int) (map[string]interface{}, error) {
	if room == nil {
		return nil, fmt.Errorf("room is nil")
	}

	if room.Questions == nil {
		return nil, fmt.Errorf("no questions found in the room")
	}

	if questionNumber < 0 {
		return nil, fmt.Errorf("question number must be non-negative")
	}

	if questionNumber >= len(room.Questions) {
		return nil, fmt.Errorf("question number %d is out of range; total questions available: %d", questionNumber, len(room.Questions))
	}

	questionKey := strconv.Itoa(questionNumber)

	question, exists := room.Questions[questionKey]
	if !exists {
		return nil, fmt.Errorf("question with number %d not found", questionNumber)
	}

	data := map[string]interface{}{
		"flag_url": question.FlagURL,
	}

	if room.GameMode == "MCQ" {
		data["options"] = question.Options
	}

	return data, nil
}

// validateAnswer checks if a user's answer to a question is correct.
//
// It takes the following arguments:
//   - room: Pointer to the game.Room struct representing the game room
//   - questionIndex: The index of the question the answer is for (zero-based)
//   - userAnswer: The answer submitted by the user
//
// The function returns a map containing the user's answer and the correct answer, and an error if:
//   - The provided room pointer is nil
//   - The room has no questions
//   - The question index is negative
//   - The question index is out of range (greater than or equal to the total number of questions)
//   - The question with the specified index is not found in the room
func validateAnswer(room *game.Room, questionIndex int, userAnswer string) (map[string]interface{}, error) {
	if room == nil {
		return nil, fmt.Errorf("room is nil")
	}

	if room.Questions == nil {
		return nil, fmt.Errorf("no questions found in the room")
	}

	if questionIndex < 0 {
		return nil, fmt.Errorf("question index must be non-negative")
	}

	if questionIndex >= len(room.Questions) {
		return nil, fmt.Errorf("question index %d is out of range; total questions available: %d", questionIndex, len(room.Questions))
	}

	questionKey := strconv.Itoa(questionIndex)
	question, exists := room.Questions[questionKey]
	if !exists {
		return nil, fmt.Errorf("question with index %d not found", questionIndex)
	}

	response := map[string]interface{}{
		"answer":  userAnswer,
		"correct": question.Answer,
	}

	return response, nil
}
