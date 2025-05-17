package internals

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/adimail/fun-with-flags/internals/game"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

var rooms = make(map[string]*game.Room)

type ErrorResponse struct {
	Error string `json:"error"`
}

// generateRoomID generates a random 4-digit room identifier.
// It uses the current time as a seed to ensure uniqueness across
// multiple server instances.
//
// Returns:
//   - string: A random numeric string between 0000 and 9999
func generateRoomID() string {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	return strconv.Itoa(rng.Intn(10000))
}

// generatePlayerID generates a unique identifier for a player.
// Similar to generateRoomID, it uses the current time as a seed
// to ensure uniqueness of player IDs within the game session.
//
// Returns:
//   - string: A random numeric string between 0000 and 9999
func generatePlayerID() string {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	return strconv.Itoa(rng.Intn(10000))
}

// ValidateCreateRoomRequest validates the parameters for creating a new game room.
// It ensures that all required fields are present and within acceptable ranges.
//
// Parameters:
//   - req: Pointer to CreateRoomRequest containing room creation parameters
//
// Returns:
//   - error: nil if validation passes, error with description if validation fails
//
// Validates:
//   - Time limit (3-10 minutes)
//   - Number of questions (10-25)
//   - Game type (must not be empty)
func ValidateCreateRoomRequest(req *game.CreateRoomRequest) error {
	if req.TimeLimit < 3 || req.TimeLimit > 10 {
		return errors.New("time limit must be between 3 and 10 minutes")
	}
	if req.NumQuestions < 10 || req.NumQuestions > 25 {
		return errors.New("number of questions must be between 10 and 25")
	}
	if req.GameType == "" {
		return errors.New("game type is required")
	}
	return nil
}

// createRoomHandler processes HTTP POST requests to create a new game room.
// It validates the request, generates a unique room ID, and initializes
// the room with the specified parameters and questions.
//
// HTTP Method: POST
// Content-Type: application/json
//
// Request Body:
//   - CreateRoomRequest struct with additional HostUsername field
//
// Response:
//   - 200: Room created successfully with room details
//   - 400: Invalid request parameters
//   - 403: Maximum room limit reached
//   - 500: Server error during question generation
func createRoomHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid method", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		game.CreateRoomRequest
		HostUsername string `json:"hostUsername"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Invalid JSON format",
		})
		return
	}

	if err := ValidateCreateRoomRequest(&req.CreateRoomRequest); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	if len(rooms) >= 10 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Maximum number of rooms (10) reached. Cannot create more rooms.",
		})
		return
	}

	if req.HostUsername == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Host username is required",
		})
		return
	}

	questions, err := generateQuestions(req.NumQuestions, req.GameType)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to generate questions: " + err.Error(),
		})
		return
	}

	roomID := generateRoomID()
	room := &game.Room{
		Code:      roomID,
		Hostname:  req.HostUsername,
		Players:   make(map[*websocket.Conn]*game.Player),
		Questions: make(map[string]*game.Question),
		Start:     false,
		TimeLimit: req.TimeLimit,
		GameMode:  req.GameType,
	}

	for i, q := range questions {
		room.Questions[strconv.Itoa(i)] = &q
	}

	rooms[roomID] = room

	response := map[string]interface{}{
		"code":         room.Code,
		"host":         room.Hostname,
		"players":      getSerializablePlayers(room),
		"start":        room.Start,
		"timeLimit":    room.TimeLimit,
		"numQuestions": len(questions),
		"gamemode":     room.GameMode,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// joinRoomHandler processes HTTP POST requests for players joining an existing room.
// It validates the request, checks room capacity, and ensures unique usernames
// within the room.
//
// HTTP Method: POST
// Content-Type: application/json
//
// Request Body:
//   - Username: Player's desired username (4-20 characters)
//   - RoomID: Target room identifier
//
// Response:
//   - 200: Successfully joined room with room details
//   - 400: Invalid request parameters
//   - 404: Room not found
//   - 409: Username conflict
//   - 403: Room is full
//   - 401: Game has started in this room
func joinRoomHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid method", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
		RoomID   string `json:"roomID"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid JSON format"})
		return
	}

	// Validate username
	if req.Username == "" || len(req.Username) < 4 || len(req.Username) > 20 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Username must be between 4 and 20 characters"})
		return
	}

	// Validate room ID
	if req.RoomID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Room ID is required"})
		return
	}

	room, exists := rooms[req.RoomID]

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Room not found"})
		return
	}

	if room.Start {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Game has already started. You cannot join now."})
		return
	}

	if len(room.Players) >= 9 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Room is full, only 9 members can join in one room"})
		return
	}

	usernameExists := false
	for _, player := range room.Players {
		if player != nil && strings.EqualFold(player.Username, req.Username) {
			usernameExists = true
			break
		}
	}

	if usernameExists {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: fmt.Sprintf("Username '%s' is already taken. Please choose another username.", req.Username),
		})
		return
	}

	response := map[string]interface{}{
		"code":         room.Code,
		"host":         room.Hostname,
		"players":      getSerializablePlayers(room),
		"timeLimit":    room.TimeLimit,
		"numQuestions": len(room.Questions),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// getRoomHandler retrieves and returns the current state of a specified room.
// It provides room details including connected players, settings, and game state.
//
// HTTP Method: GET
// Path Parameter:
//   - id: Room identifier
//
// Response:
//   - 200: Room details including players and settings
//   - 404: Room not found
func getRoomHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	room, exists := rooms[roomID]

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Room not found"})
		return
	}

	response := map[string]interface{}{
		"code":         room.Code,
		"host":         room.Hostname,
		"players":      getSerializablePlayers(room),
		"timeLimit":    room.TimeLimit,
		"numQuestions": len(room.Questions),
		"gamemode":     room.GameMode,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// adminHandler returns the info about the total games currently operating in the server
func adminHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
		return
	}

	if len(rooms) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "No room found"})
		return
	}

	// Create a response structure to hold all room details
	var allRooms []map[string]interface{}
	for _, room := range rooms {
		roomDetails := map[string]interface{}{
			"code":         room.Code,
			"host":         room.Hostname,
			"timeLimit":    room.TimeLimit,
			"numQuestions": len(room.Questions),
			"gameStarted":  room.Start,
			"players":      getSerializablePlayers(room),
		}
		allRooms = append(allRooms, roomDetails)
	}

	// Respond with the JSON of all rooms
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"rooms": allRooms,
	})
}
