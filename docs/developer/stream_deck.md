# Stream Deck Technical Architecture

The Stream Deck integration module (`companion/stream_deck.py`) manages hardware key profiles, visual SVG rendering, and Elgato Stream Deck WebSocket protocol synchronization.

## Architecture & Data Flow

1. **`StreamDeckButton` & `StreamDeckProfile`**:
   - Manages button key indexes, action types (`command`, `profile_switch`, `status`), labels, execution state, and LED accent colors.
   - Automatically populates 3x5/4x8 key grids from CmdBar categories loaded via `load_config()`.

2. **`VisualRenderer` Performance Engine**:
   - Renders 72x72 px button displays using SVG XML and Base64 Data URLs.
   - Features an LRU render cache for sub-millisecond throughput (<0.1ms cached, <5ms uncached).
   - Dynamically wraps text and renders status badges (`⏳`, `✓`, `✗`) and LED accent borders.

3. **`StreamDeckPluginProtocol` & WebSocket Interface**:
   - Implements Elgato Stream Deck WebSocket SDK protocol messages (`registerPlugin`, `setTitle`, `setImage`, `setState`, `showAlert`, `showOk`, `switchToProfile`, `setFeedback`).

4. **D-Bus & Security**:
   - Bridges Stream Deck key triggers with `CmdBarDBusService`.
   - Sanitizes user input against XML/script injection and command manipulation.
