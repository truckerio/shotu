# Mechanic progress

`useMechanicProgress` autosaves diagnosis and work-performed fields on an
existing assigned workorder. It is intentionally separate from workorder
creation drafts: mechanics do not create draft workorders.

The hook keeps a local recovery copy until the server confirms a save. Call
`flush({ recordActivity: true })` before leaving a workorder so the server can
write one grouped activity event for the editing session.
