extends Node
## Playtest Watcher event logger (autoload "PlaytestLog"). GDScript twin of playtest-watcher/public/playtest-log.js.
## Off unless the command line has `-- --playtest=<sessionId> --pw=<watcher url>`; when off, every call is a no-op.
## Copy this file into a game unchanged. Canonical copy: playtest-watcher/godot/playtest_log.gd.

const IDLE_MS := 8000
const FLUSH_SECONDS := 0.5

var enabled := false
var session := ""
var origin := ""
var queue: Array = []  ## events waiting to be sent: {t, type, data}
var sending: Array = []  ## the batch in flight, put back on failure
var http: HTTPRequest
var last_input_ms := 0
var idle_logged := false
var awaiting_first_touch := ""
var _since_flush := 0.0
var _closing := false


func _ready() -> void:
	if not configure(OS.get_cmdline_user_args()):
		set_process(false)
		set_process_input(false)
		return
	http = HTTPRequest.new()
	http.timeout = 5.0
	http.request_completed.connect(_on_done)
	add_child(http)
	get_tree().auto_accept_quit = false
	log_event("logger_start", {"kind": "progress", "url": "res://", "w": get_viewport().size.x, "h": get_viewport().size.y})


## Reads --playtest=<id> and --pw=<url> from the args. Returns whether logging is on.
func configure(args: PackedStringArray) -> bool:
	enabled = false
	var id := ""
	var url := ""
	for a in args:
		if a.begins_with("--playtest="):
			id = a.trim_prefix("--playtest=")
		elif a.begins_with("--pw="):
			url = a.trim_prefix("--pw=")
	var ok := RegEx.new()
	ok.compile("^[a-z0-9-]{1,80}$")
	if ok.search(id) != null and url != "":
		session = id
		origin = url.rstrip("/")
		enabled = true
		last_input_ms = Time.get_ticks_msec()
	return enabled


func log_event(type: String, data = null) -> void:
	if not enabled or type == "":
		return
	var e := {"t": int(Time.get_unix_time_from_system() * 1000.0), "type": type}
	if data != null:
		e["data"] = data
	queue.append(e)


## A new screen appeared; the next tap is recorded as first_touch.
func screen(name: String) -> void:
	log_event("screen", {"kind": "progress", "name": name})
	awaiting_first_touch = name if enabled else ""


func text(id: String, chars: int) -> void:
	log_event("text_shown", {"kind": "text_shown", "id": id, "chars": chars})


func text_closed(id: String) -> void:
	log_event("text_closed", {"kind": "text_closed", "id": id})


## What goes over the wire for the queued events: a JSON array of {t, type, data}.
func payload(batch: Array = queue) -> String:
	return JSON.stringify(batch)


func url() -> String:
	return "%s/events/%s" % [origin, session]


func _input(e: InputEvent) -> void:
	var pressed: bool = (e is InputEventScreenTouch and e.pressed) or (e is InputEventMouseButton and e.pressed) or (e is InputEventKey and e.pressed)
	if not pressed and not (e is InputEventScreenDrag):
		return
	last_input_ms = Time.get_ticks_msec()
	idle_logged = false
	if awaiting_first_touch != "" and not (e is InputEventKey):
		var scr := awaiting_first_touch
		awaiting_first_touch = ""
		log_event("first_touch", {"kind": "first_touch", "screen": scr, "target": describe(get_tree().root, e.position)})


## The node that received a press at pos: the topmost visible Control under it that takes the mouse
## (or a node with meta "pw"). Reported as Class.name, plus the label for buttons.
func describe(from: Node, pos: Vector2) -> String:
	var hit := _topmost(from, pos)
	if hit == null:
		return "unknown"
	var s := "%s.%s" % [hit.get_class(), hit.name]
	if hit.has_meta("pw"):
		s = str(hit.get_meta("pw"))
	elif hit is Button and hit.text != "":
		s += ":" + hit.text.strip_edges()
	return s


func _topmost(n: Node, pos: Vector2) -> Control:
	var kids := n.get_children()
	kids.reverse() # later siblings draw on top
	for c in kids:
		if c is CanvasItem and not c.visible:
			continue
		var below := _topmost(c, pos)
		if below != null:
			return below
	if n is Control and n.is_visible_in_tree() and n.mouse_filter != Control.MOUSE_FILTER_IGNORE and n.get_global_rect().has_point(pos):
		return n
	return null


func _process(delta: float) -> void:
	var quiet := Time.get_ticks_msec() - last_input_ms
	if quiet >= IDLE_MS and not idle_logged:
		log_event("idle", {"kind": "idle", "seconds": int(round(quiet / 1000.0))})
		idle_logged = true
	_since_flush += delta
	if _since_flush >= FLUSH_SECONDS:
		_since_flush = 0.0
		flush()


## One request at a time. A failed batch goes back on the front of the queue for the next tick.
func flush() -> void:
	if not enabled or queue.is_empty() or not sending.is_empty() or http == null:
		return
	sending = queue
	queue = []
	var err := http.request(url(), ["content-type: application/json"], HTTPClient.METHOD_POST, payload(sending))
	if err != OK:
		_requeue()


func _on_done(result: int, code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code < 200 or code >= 300:
		_requeue()
	else:
		sending = []
	if _closing:
		get_tree().quit()


func _requeue() -> void:
	queue = sending + queue
	sending = []


func _notification(what: int) -> void:
	if what != NOTIFICATION_WM_CLOSE_REQUEST or not enabled or _closing:
		return
	_closing = true
	log_event("page_hide", {"kind": "quit"})
	flush()
	if sending.is_empty():
		get_tree().quit()
	else:
		get_tree().create_timer(1.5).timeout.connect(func(): get_tree().quit()) # don't hang on a dead server
