# @onetest/dsh-deck-canvas

The browser half of [`@onetest/dsh-deck`](../dsh-deck/README.md): the deck card the DeepSeek Harness web GUI renders for a `deck_view` tool call. Install and run through that package — this one is not useful alone.

## What it renders

A keyed `tool.call.toolview` under `deck_view`: the live deck in a 16:9 frame, a slide counter, and previous/next controls. Octodeck scales its fixed 1280×720 canvas to whatever box it is given, so the frame resizes with the surrounding column.

It reads the `deck_view` tool result's canonical value — `deckId`, `route`, `slideCount`, `theme` — which reaches the browser through the tool's `presentationMeta` projection, so the card survives session replay. A value from any other tool is rejected rather than rendered as an empty frame.

It registers a **tool view**, not the details column. `conversation.details.tool` is a single-occupant slot: registering there would have displaced every other tool's details rendering.

Slide navigation drives the iframe through the framework's own hash format (`#/2`). That format is Octodeck's, not this package's — see `src/framework/deck.ts` in the repository root.

## Build

```bash
npm run bundle --workspace @onetest/dsh-deck-canvas
```

This emits `lib/client.js`, a closure-factory artifact the harness module table loads: the bundle hands its factory to `window.__ModuleLoader__.load` and resolves React, cordis, and the harness client packages through the injected `require` rather than bundling copies of them. `tests/artifact.spec.ts` asserts that contract, including that React stays external — an earlier build silently inlined it.

## Limitations

Rendering is verified in a real browser. The chat-driven path — a model calling `deck_create` and `deck_view` and the card appearing in the transcript — needs a `DEEPSEEK_API_KEY` and has not been exercised.

`deck_create` declares no `presentationMeta`, so the card appears only on a `deck_view` call. Nothing yet instructs the model to make that call; the authoring skill that would is a later phase.
