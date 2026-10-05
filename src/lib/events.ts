import { EventEmitter } from "node:events";

// One process, one bus: every open SSE connection subscribes here, and a new
// message is broadcast to all of them. This only works because the app runs
// on exactly one machine (see fly.toml) --- a second machine would have its
// own bus and clients would miss events. Events are namespaced per room
// (`room:${slug}`) since, unlike a single-room app, an SSE connection here
// must only hear its own room.
export const bus = new EventEmitter();
bus.setMaxListeners(0);
