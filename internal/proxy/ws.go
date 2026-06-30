package proxy

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// wsHandler upgrades connections and registers them.
func (a *App) wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := a.wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("ws upgrade:", err)
		return
	}

	a.wsMu.Lock()
	a.wsClients[conn] = true
	a.wsMu.Unlock()

	// Keep alive — read until disconnect
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}

	a.wsMu.Lock()
	delete(a.wsClients, conn)
	a.wsMu.Unlock()
	conn.Close()
}

// broadcast sends a JSON message to all connected WebSocket clients.
// Each write gets a 2-second deadline so a slow/dead client can never block the proxy.
func (a *App) broadcast(msg interface{}) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	a.wsMu.Lock()
	defer a.wsMu.Unlock()

	for conn := range a.wsClients {
		conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			conn.Close()
			delete(a.wsClients, conn)
		}
	}
}
