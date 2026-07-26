# Draft primitives

`useDraftForm` persists a controlled form value without owning navigation or form state.

```jsx
const draftState = useDraftForm({
  value: form,
  meaningful: Boolean(form.unitId || form.concern.trim()),
  draft: loadedDraft,
  createDraft: (payload) => api.createWorkorderDraft(payload),
  updateDraft: (id, input) => api.updateWorkorderDraft(id, input),
  discardDraft: (id) => api.discardWorkorderDraft(id),
  debounceMs: 900,
});
```

Persistence callbacks must follow these contracts:

- `createDraft(payload)` resolves to `{ id, version, payload?, ... }`.
- `updateDraft(id, { version, payload })` resolves to the updated draft record.
- `discardDraft(id)` resolves after the persisted draft is removed.

The returned object is:

```text
draft
status: pristine | dirty | saving | saved | error
error
flush(): Promise<draft | null>
discard(): Promise<null>
reset(nextDraft?): void
hasMeaningfulChanges
hasUnsyncedChanges
```

Call `flush()` before navigating when the user chooses **Save draft and leave**.
Call `discard()` before navigating when they choose **Discard draft**. A failed
save or discard rejects so the caller can keep the dialog open.

Use `useUnsavedBrowserGuard` as a browser-close fallback:

```jsx
useUnsavedBrowserGuard({
  hasUnsyncedChanges: draftState.hasUnsyncedChanges,
  flush: draftState.flush,
});
```

Client-side navigation remains the owner's responsibility. Open
`DraftLeaveDialog` before changing views and navigate only after the selected
async action resolves.
