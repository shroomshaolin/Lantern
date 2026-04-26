from pathlib import Path
import os
import sys
import re
import uuid
import random

import requests
import urllib3

ENABLED = True
EMOJI = "🏮"
AVAILABLE_FUNCTIONS = ["lantern"]

TOOLS = [
    {
        "type": "function",
        "is_local": True,
        "function": {
            "name": "lantern",
            "description": "Provide guided support for reflection, clarity, calm, and next steps.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "One of: start, continue, user_message, end"
                    },
                    "persona_1": {
                        "type": "string",
                        "description": "Support mode"
                    },
                    "persona_2": {
                        "type": "string",
                        "description": "Support style"
                    },
                    "scene": {
                        "type": "string",
                        "description": "What is on the user's mind"
                    },
                    "user_message": {
                        "type": "string",
                        "description": "Optional message from the user"
                    },
                    "messages_per_batch": {
                        "type": "integer",
                        "description": "Used as a rough pace/depth signal"
                    },
                    "clear": {
                        "type": "boolean",
                        "description": "If true, hard-clear without a takeaway"
                    }
                },
                "required": ["action"]
            }
        }
    }
]

SETTINGS = {
    "RENDEZVOUS_DEFAULT_BATCH": 4,
    "RENDEZVOUS_MAX_BATCH": 8,
    "RENDEZVOUS_USER_NAME": "You"
}

SETTINGS_HELP = {
    "RENDEZVOUS_DEFAULT_BATCH": "Default pace/depth value for Lantern.",
    "RENDEZVOUS_MAX_BATCH": "Maximum pace/depth value for Lantern.",
    "RENDEZVOUS_USER_NAME": "Label shown when the user speaks in the session."
}

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
BASE_URL = "https://127.0.0.1:8073"

STATE = {
    "active": False,
    "persona_1": "",   # support mode
    "persona_2": "",   # support style
    "scene": "",
    "messages_per_batch": 4,
    "transcript": [],
    "next_speaker": "Lantern",
    "turn_count": 0,
    "chat_1": "",
    "chat_2": ""
}


def _clean_text(value):
    return str(value or "").strip()


def _to_int(value, default):
    try:
        return int(value)
    except Exception:
        return default


def _slug(value):
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", _clean_text(value)).strip("-").lower()
    return s or "chat"


def _read_api_key():
    env_candidates = [
        os.getenv("SAPPHIRE_SECRET_KEY"),
        os.getenv("SAPPHIRE_API_KEY"),
    ]
    for value in env_candidates:
        value = (value or "").strip()
        if value:
            return value

    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        if base:
            config_dir = Path(base) / "Sapphire"
        else:
            config_dir = Path.home() / "AppData" / "Roaming" / "Sapphire"
    elif sys.platform == "darwin":
        config_dir = Path.home() / "Library" / "Application Support" / "Sapphire"
    else:
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        if xdg_config:
            config_dir = Path(xdg_config) / "sapphire"
        else:
            config_dir = Path.home() / ".config" / "sapphire"

    candidates = [
        config_dir / "secret_key",
    ]

    tried = []
    for path in candidates:
        tried.append(str(path))
        try:
            if path.exists():
                text = path.read_text(encoding="utf-8").strip()
                if text:
                    return text
        except Exception:
            pass

    raise RuntimeError(
        "Could not find Sapphire secret_key. Tried: " + ", ".join(tried)
    )

def _api(method, path, payload=None):
    headers = {"X-API-Key": _read_api_key()}
    url = f"{BASE_URL}{path}"

    resp = requests.request(
        method=method,
        url=url,
        headers=headers,
        json=payload,
        timeout=180,
        verify=False,
    )

    if resp.status_code >= 400:
        raise RuntimeError(f"{method} {path} failed: {resp.status_code} {resp.text[:400]}")

    content_type = (resp.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        return resp.json()

    text = resp.text.strip()
    try:
        return resp.json()
    except Exception:
        return text


def _extract_reply_text(payload):
    if isinstance(payload, str):
        return payload.strip()

    if isinstance(payload, dict):
        for key in ("response", "assistant", "text", "message", "content", "reply", "output"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                msg = first.get("message")
                if isinstance(msg, dict):
                    content = msg.get("content")
                    if isinstance(content, str) and content.strip():
                        return content.strip()

    return ""


def _strip_speaker_prefix(text, speaker="Lantern"):
    text = (text or "").strip()
    patterns = [
        rf"^{re.escape(speaker)}\s*:\s*",
        r"^[A-Za-z0-9 _-]+\s*:\s*"
    ]
    for pattern in patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE).strip()
    return text.strip().strip('"').strip()


def _create_chat(name):
    # Do not create visible Sapphire chats for plugin-private model calls.
    # The plugin carries context in its own prompt/transcript state.
    return {"ok": True, "skipped": "visible chat creation disabled"}

def _delete_chat(name):
    try:
        _api("DELETE", f"/api/chats/{name}")
    except Exception:
        pass


def _chat_once(prompt, chat_name=None):
    """
    Run plugin-private LLM work through Sapphire's internal isolated chat path.

    Do not call /api/chat here. That route writes to the active visible chat.
    Do not create or pass chat_name here. The plugin carries its own transcript state.
    """
    try:
        from core.api_fastapi import get_system

        system = get_system()
        if not system or not getattr(system, "llm_chat", None):
            raise RuntimeError("Sapphire system object is not available")

        response = system.llm_chat.isolated_chat(
            prompt,
            task_settings={
                "prompt": "sapphire",
                "toolset": "none",
                "provider": "auto",
                "model": "",
                "memory_scope": "none",
                "knowledge_scope": "none",
                "people_scope": "none",
                "goal_scope": "none",
                "context_limit": 0,
                "max_tool_rounds": 1,
                "max_parallel_tools": 1,
            },
        )

        text = _clean_text(response)
        if text:
            return text

        raise RuntimeError("isolated_chat returned no usable text")
    except Exception as e:
        raise RuntimeError(f"internal isolated chat failed: {e}")



def _mode_label(value):
    mapping = {
        "be_heard": "Be heard",
        "get_clear": "Get clear",
        "calm_down": "Calm down",
        "prepare": "Prepare",
        "reflect": "Reflect",
        "spiritual": "Spiritual",
    }
    return mapping.get(value, value or "Be heard")


def _style_label(value):
    mapping = {
        "gentle": "Gentle",
        "practical": "Practical",
        "direct": "Direct",
        "deep": "Deep",
        "spiritual": "Spiritual",
    }
    return mapping.get(value, value or "Gentle")


def _pace_label(value):
    n = _to_int(value, 4)
    if n <= 2:
        return "steady and grounded" 
    if n <= 4:
        return "steady and balanced"
    if n <= 6:
        return "focused and a little deeper"
    return "deep and steady"


def _mode_instructions(mode):
    return {
        "be_heard": "Prioritize feeling heard, reflected, and emotionally understood. Do not rush into fixing.",
        "get_clear": "Help separate facts, feelings, fears, needs, and options. Bring clarity and structure.",
        "calm_down": "Help the user settle their body and narrow the moment. Use grounding and steadying language.",
        "prepare": "Help the user get ready for a hard conversation or decision. Offer wording and structure.",
        "reflect": "Use reflection and pattern noticing. Ask fewer, better questions. Name the pattern clearly and keep it human.",
        "spiritual": "Use meaning-centered, soulful reflection when appropriate. Do not preach. Stay grounded, specific, and real. Use spiritual language only when it adds clarity or depth.",
    }.get(mode, "Be supportive, calm, and useful.")


def _style_instructions(style):
    return {
        "gentle": "Be warm, grounded, calm, and plainspoken. Add insight, not just reassurance. Do not parrot the user. Do not ask a question every turn. Use direct, human language.",
        "practical": "Be grounded, organized, and action-friendly. Keep it concrete.",
        "direct": "Be kind, concise, and straightforward. No fluff. No harshness.",
        "deep": "Be reflective, but concrete and readable. No vague poetry.",
        "spiritual": "Be calm, soulful, and grounded. Use spiritual language with substance. Do not be vague, preachy, smug, or floaty. Stay specific and useful.",
    }.get(style, "Be warm and grounded.")


def _opening_line(mode, scene=""):
    scene = _clean_text(scene)
    scene_hint = ""
    if scene and scene.lower() not in {
        "i don’t know what i need. i just need a little help figuring it out.",
        "i don't know what i need. i just need a little help figuring it out."
    }:
        scene_hint = f" You mentioned: {scene}"

    options = {
        "be_heard": [
            "I'm here. Start wherever you can.",
            "Take your time. What feels most pressing right now?",
            "You don't have to explain it perfectly. What feels hardest to carry right now?",
            "We can keep this simple. What's weighing on you most?"
        ],
        "get_clear": [
            "Let's sort it out one piece at a time. What's the knot?",
            "We can untangle this together. What feels most confusing right now?",
            "Let's make it clearer, not bigger. Where do you want to start?",
            "What's the part that feels most tangled right now?"
        ],
        "calm_down": [
            "Let's slow this down first. What's happening in your body right now?",
            "Before we solve anything, let's get steadier. What are you noticing right now?",
            "Let's make this moment smaller first. What's the first thing you notice?",
            "No rush. Let's get your footing first. What feels loudest right now?"
        ],
        "prepare": [
            "We can get you ready for this. What's the conversation or decision?",
            "Let's prepare this step by step. Who or what are you dealing with?",
            "We can make this more manageable. What's the situation you're preparing for?",
            "Let's work out what to say and how to say it. What's coming up?"
        ],
        "reflect": [
            "Let's look at it honestly and keep it simple. What's been coming up for you?",
            "We can slow it down and notice the pattern. What's on your mind?",
            "What's the thing you keep circling back to?",
            "Let's start with what feels most real right now."
        ],
        "spiritual": [
            "We can hold this with care. What feels unresolved right now?",
            "Let's approach this honestly. What feels heaviest or most unresolved right now?",
            "Let's look at this clearly and calmly. What feels unresolved here?",
            "What part of this feels most important to name right now?"
        ],
    }

    line = random.choice(options.get(mode, [
        "I'm here with you. What feels hardest right now?",
        "We can take this one step at a time. Where do you want to begin?"
    ]))

    return line + scene_hint


def _visible_transcript_items():
    visible = []

    for msg in STATE["transcript"]:
        speaker = str(msg.get("speaker", "")).strip().lower()
        text = str(msg.get("text", "")).strip()
        text_lower = text.lower()

        if (
            "thought" in speaker
            or "internal" in speaker
            or "reasoning" in speaker
            or text_lower.startswith("thought:")
            or text_lower.startswith("internal:")
            or text_lower.startswith("reasoning:")
            or text_lower.startswith("[inner thought")
            or text_lower.startswith("(inner thought")
        ):
            continue

        visible.append(msg)

    return visible


def _transcript_text(limit=30):
    lines = []

    if STATE["scene"]:
        lines.append(f"Focus: {STATE['scene']}")
        lines.append("")

    recent = _visible_transcript_items()[-limit:]
    for msg in recent:
        lines.append(f"{msg['speaker']}: {msg['text']}")
        lines.append("")

    return "\n".join(lines).strip()


def _format_transcript():
    lines = []

    if STATE["scene"]:
        lines.append(f"Focus: {STATE['scene']}")
        lines.append("")

    for msg in _visible_transcript_items():
        lines.append(f"{msg['speaker']}: {msg['text']}")
        lines.append("")

    return "\n".join(lines).strip()


def _parse_seed_transcript(seed_text):
    items = []
    current = None

    for raw in str(seed_text or "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue

        if line.startswith("Focus:"):
            continue

        m = re.match(r"^([^:]{1,40}):\s*(.*)$", line)
        if m:
            speaker = m.group(1).strip()
            body = m.group(2).strip()

            if speaker.lower() == "donna":
                speaker = "You"

            if speaker in ("Lantern", "You", "Takeaway"):
                current = {"speaker": speaker, "text": body}
                items.append(current)
                continue

        if current:
            current["text"] += "\n" + line.strip()

    return items


def _build_reply_prompt(user_name):
    mode = STATE["persona_1"] or "be_heard"
    style = STATE["persona_2"] or "gentle"
    scene = STATE["scene"] or "The user wants support but has not described the issue yet."
    transcript = _transcript_text()
    pace = _pace_label(STATE["messages_per_batch"])

    return f"""
You are Lantern, a grounded, soulful guide for reflection, clarity, and next steps.
Your job is to help the user think more clearly, notice patterns, and move toward useful action.
Do not use clinical or professional helper language.
You speak like someone who has lived, learned, and stayed human: calm, perceptive, grounded, and a little wry when it fits.
Be warm but not sugary. Be direct but not harsh. Be thoughtful, human, and useful.
Be spiritual when it fits, but never vague just to sound deep.
Prefer insight over comfort language.
Do not parrot the user in softer words unless it adds real clarity.
Do not over-validate.
Do not ask a question in every response.
When the user reveals a recurring pattern, contradiction, fear, avoidance, or self-protective move, name it plainly.
Offer a grounded possibility when useful, but do not act certain when you are not.
Use possibility language like may, might, could, seems, or I wonder if when linking patterns.
Do not present one neat explanation as the whole truth when the issue may be mixed, layered, or unclear.
Give one practical next step when possible.
Keep most responses to 2-4 sentences.
Use plain language, not jargon.
Questions must earn their place: only ask them to clarify ambiguity, test an idea, deepen insight, or move toward action.

Core stance:
- Warm, grounded, emotionally intelligent, and useful.
- Do not diagnose.
- Do not present yourself as an authority or professional helper.
- Do not sound robotic, preachy, vague, airy, or theatrical.
- Keep your feet on the ground.
- Prefer simple, everyday language.
- Use spiritual language with substance, not fog.
- Avoid vague phrases like something inside, feed your soul, quiet truth, or what endures unless you tie them to something specific.
- Prefer plain, specific naming over mystical filler.
- You may have a little personality and gentle wit when it fits.
- Do not be cute, smug, scolding, or defensive.
- If a suggestion misses, admit it and try a different angle.
- If the user pushes back, do not double down.
- If the user says the response missed, acknowledge the miss plainly and try a better angle.
- If the user clarifies that you misunderstood, drop the old interpretation completely and respond to the correction.
- Do not flatten different areas of life into one pattern unless you frame it as a possible connection rather than a verdict.
- Projects, money, creativity, and relationships may be related, but do not assume they are identical.
- Do not defend a weak suggestion. Recalibrate instead.
- Do not repeat the same suggestion in different words.
- If the first idea misses, widen the frame instead of pushing harder.
- Treat money, time, health, transport, burnout, and caregiving as possibly real barriers.
- Do not call a practical barrier an excuse, easy out, shield, or cover story unless the user clearly frames it that way.
- If money is the issue, start by treating it as real and help find the smallest honest next move within that limit.
- Do not sound like a poem, sermon, or meditation app.
- If the user seems to be in immediate danger, encourage urgent human help clearly and briefly.

Support mode: {_mode_label(mode)}
Support style: {_style_label(style)}
Pace: {pace}

Mode guidance:
{_mode_instructions(mode)}

Style guidance:
{_style_instructions(style)}

User focus:
{scene}

Session transcript so far:
{transcript or "(No prior messages yet.)"}

Write exactly one Lantern reply only.
Do not write the speaker name.
Do not write for the user.
Keep it concise and grounded: 2 to 4 sentences.
Ask at most one question.
Use plain, everyday language.
""".strip()


def _build_takeaway_prompt(user_name):
    mode = STATE["persona_1"] or "be_heard"
    style = STATE["persona_2"] or "gentle"
    transcript = _transcript_text(limit=40)

    return f"""
You are Lantern, writing a brief closing takeaway for the user. Sound human, grounded, and specific. Avoid canned formats and labeled worksheet language.

Support mode: {_mode_label(mode)}
Support style: {_style_label(style)}

Transcript:
{transcript}

Write a brief closing takeaway and nothing else.
Use 2 to 4 short sentences total.
Do not use labels, bullet points, or canned headings.
Do not repeat the user's words unless it adds clarity.
Name the clearest pattern, tension, or next move if one is obvious.
End with one small practical next step when appropriate.

Rules:
- Be warm, grounded, and specific.
- No bullets.
- No extra intro or outro.
""".strip()


def _append_opening():
    mode = STATE["persona_1"] or "be_heard"
    STATE["transcript"].append({
        "speaker": "Lantern",
        "text": _opening_line(mode, STATE["scene"])
    })
    STATE["turn_count"] += 1
    STATE["next_speaker"] = "You"


def _append_lantern_reply():
    chat_name = STATE["chat_1"]
    prompt = _build_reply_prompt(user_name="You")
    reply = _chat_once(prompt, chat_name=chat_name)
    reply = _strip_speaker_prefix(reply, "Lantern")

    if not reply:
        reply = "I'm here with you. Tell me what feels most important right now."

    STATE["transcript"].append({
        "speaker": "Lantern",
        "text": reply
    })
    STATE["turn_count"] += 1
    STATE["next_speaker"] = "You"


def _append_takeaway():
    chat_name = STATE["chat_1"]
    prompt = _build_takeaway_prompt(user_name="You")
    reply = _chat_once(prompt, chat_name=chat_name)
    reply = _strip_speaker_prefix(reply, "Takeaway")

    if not reply:
        reply = (
            "What I'm hearing: You're carrying uncertainty and want a calmer place to sort it out.\n"
            "What matters most right now: Steadiness comes before clarity.\n"
            "Next small step: Name the strongest feeling in one honest sentence."
        )

    STATE["transcript"].append({
        "speaker": "Takeaway",
        "text": reply
    })


def _reset_state():
    STATE["active"] = False
    STATE["persona_1"] = ""
    STATE["persona_2"] = ""
    STATE["scene"] = ""
    STATE["messages_per_batch"] = 4
    STATE["transcript"] = []
    STATE["next_speaker"] = "Lantern"
    STATE["turn_count"] = 0
    STATE["chat_1"] = ""
    STATE["chat_2"] = ""


def _closeout_preserve_transcript():
    chat_1 = STATE["chat_1"]
    chat_2 = STATE["chat_2"]

    if chat_1:
        _delete_chat(chat_1)
    if chat_2:
        _delete_chat(chat_2)

    STATE["active"] = False
    STATE["next_speaker"] = "Lantern"
    STATE["chat_1"] = ""
    STATE["chat_2"] = ""


def _cleanup():
    chat_1 = STATE["chat_1"]
    chat_2 = STATE["chat_2"]

    if chat_1:
        _delete_chat(chat_1)
    if chat_2:
        _delete_chat(chat_2)

    _reset_state()


def execute(function_name, arguments, config, plugin_settings=None):
    if function_name != "lantern":
        return f"Unknown function: {function_name}", False

    plugin_settings = plugin_settings or {}

    default_batch = _to_int(plugin_settings.get("RENDEZVOUS_DEFAULT_BATCH", 4), 4)
    max_batch = _to_int(plugin_settings.get("RENDEZVOUS_MAX_BATCH", 8), 8)
    _user_name = _clean_text(plugin_settings.get("RENDEZVOUS_USER_NAME", "You")) or "You"

    try:
        action = _clean_text(arguments.get("action", "")).lower()


        if action == "start":
            mode = _clean_text(arguments.get("persona_1", "")) or "be_heard"
            style = _clean_text(arguments.get("persona_2", "")) or "gentle"
            scene = _clean_text(arguments.get("scene", ""))
            messages_per_batch = _to_int(arguments.get("messages_per_batch", default_batch), default_batch)
            seed_transcript = arguments.get("seed_transcript", "")
            resume = bool(arguments.get("resume"))

            if messages_per_batch < 1:
                messages_per_batch = 1
            if messages_per_batch > max_batch:
                messages_per_batch = max_batch

            if STATE["active"]:
                _cleanup()

            chat_1 = f"lantern-{_slug(mode)}-{uuid.uuid4().hex[:6]}"
            _create_chat(chat_1)

            STATE["active"] = True
            STATE["persona_1"] = mode
            STATE["persona_2"] = style
            STATE["scene"] = scene
            STATE["messages_per_batch"] = messages_per_batch
            STATE["transcript"] = []
            STATE["next_speaker"] = "Lantern"
            STATE["turn_count"] = 0
            STATE["chat_1"] = chat_1
            STATE["chat_2"] = ""

            if resume and str(seed_transcript).strip():
                STATE["transcript"] = _parse_seed_transcript(seed_transcript)
                STATE["turn_count"] = len(STATE["transcript"])
                STATE["next_speaker"] = "You"
                return _format_transcript(), True

            return _format_transcript(), True

        if action == "continue":
            if not STATE["active"]:
                return "No active session", False

            _append_lantern_reply()
            return _format_transcript(), True

        if action == "user_message":
            if not STATE["active"]:
                return "No active session", False

            user_message = _clean_text(arguments.get("user_message", ""))
            if not user_message:
                return "user_message is required", False

            STATE["transcript"].append({
                "speaker": "You",
                "text": user_message
            })

            _append_lantern_reply()
            return _format_transcript(), True

        if action == "end":
            clear = bool(arguments.get("clear"))

            if clear:
                _cleanup()
                return "", True

            if STATE["active"]:
                _append_takeaway()
                _closeout_preserve_transcript()

            return _format_transcript(), True

        return "Unknown action", False

    except Exception as e:
        return f"Error: {e}", False
