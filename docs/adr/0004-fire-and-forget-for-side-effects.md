# 0004 — Fire-and-Forget for messageLog and audioAlert

## Status

Accepted

## Context

Socket.IO event handlers must respond quickly. The `ack` callback must be sent to the client as soon as the event is processed. Two side effects occur after every inbound event:

1. `appendMessage(record)` — writes a line to `data/messages.jsonl` (async file I/O)
2. `playAlert(type, subtype?)` — plays an MP3 via a system audio player (spawns a child process)

The question is whether these side effects should be awaited before sending the `ack`, or whether they should run concurrently (fire-and-forget).

## Decision Drivers

- A log write failure must never cause the client to see an error — the message was received and broadcast regardless of whether it was persisted
- A missing or broken audio player must never block or error a message delivery
- The phone's UX depends on receiving fast acks; blocking on file I/O or audio playback would introduce perceptible latency
- File I/O and audio are independent of the response path — the client does not need to know if they succeeded

## Considered Options

- **Await both side effects** — ack is only sent after the record is written and the audio command is dispatched
- **Fire-and-forget both** — ack is sent immediately; side effects run concurrently and catch their own errors
- **Await messageLog, fire-and-forget audio** — hybrid approach

## Decision Outcome

Chosen option: **Fire-and-forget both side effects**

## Rationale

A log write failure is a server-internal concern. If the disk is full or the `data/` directory is unwritable, the message has already been broadcast to all clients and the conversation is unaffected. Reporting a log failure as a socket error to the phone would confuse the user ("failed" when the message clearly appeared in the thread).

Audio is inherently fire-and-forget: there is no meaningful response to "the sound played". A missing `afplay` or `mpg123` binary should silently degrade, not interrupt messaging.

Both `appendMessage` and `playAlert` catch and log their own errors internally. Neither propagates failures to callers. This contract is enforced by tests.

## Consequences

### Positive
- Socket handlers respond immediately regardless of disk or audio state
- The messaging feature degrades gracefully if logging or audio is broken
- Handler code is simpler — no `try/catch` in the hot path

### Negative
- Log write failures are silent from the client's perspective
- If persistence is critical for a deployment, operators must monitor server logs for `appendMessage` errors

### Risks
- If `appendMessage` fails on every call (e.g. permissions issue), the message history endpoint (`GET /admin/history`) returns an empty or stale list. This could confuse operators who expect to see recent messages in history

## Related Decisions

- [ADR-0002](0002-jsonl-append-only-log.md) — JSONL persistence is the mechanism being called fire-and-forget
