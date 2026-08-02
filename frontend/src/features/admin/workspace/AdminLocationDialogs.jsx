import { Copy01, XClose } from "@untitledui/icons";
import { NarrativeField } from "../../../components/forms/NarrativeField.jsx";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { Button } from "../../../components/ui/Button.jsx";

function Modal({ title, children, onClose }) {
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="admin-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><XClose /></button></header>
        {children}
      </section>
    </div>
  );
}

export function LocationSelector({ locations, value, onChange, requiredIds = [], disabled = false }) {
  function toggle(locationId) {
    if (requiredIds.includes(locationId)) return;
    onChange(value.includes(locationId)
      ? value.filter((id) => id !== locationId)
      : [...value, locationId]);
  }

  return (
    <fieldset className="admin-location-selector" disabled={disabled}>
      <legend>Locations</legend>
      <p>Select every location this user can access.</p>
      <div className="admin-location-options">
        {locations.map((location) => (
          <label key={location.id}>
            <input
              type="checkbox"
              checked={value.includes(location.id)}
              disabled={requiredIds.includes(location.id)}
              onChange={() => toggle(location.id)}
            />
            <span><strong>{location.name}</strong>{location.address ? <small>{location.address}</small> : null}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AdminLocationDialogs({
  modal,
  setModal,
  busy,
  error,
  locationDraft,
  setLocationDraft,
  onCreateLocation,
  inviteDraft,
  setInviteDraft,
  companyLocations,
  inviteLocationIds,
  setInviteLocationIds,
  selectedId,
  onCreateInvite,
  inviteDelivery,
  inviteLinkRecipient,
  inviteUrl,
  onCopyInviteLink,
}) {
  return (
    <>
      {modal === "location" ? (
        <Modal title="New location" onClose={() => setModal("")}>
          <form className="admin-modal-form" onSubmit={onCreateLocation}>
            <label><span>Name</span><input {...textEntryProps("name")} required value={locationDraft.name} onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span>Type</span><select value={locationDraft.type} onChange={(event) => setLocationDraft((current) => ({ ...current, type: event.target.value }))}><option value="yard">Yard</option><option value="shop">Shop</option><option value="office">Office</option></select></label>
            <label><span>Address</span><NarrativeField singleLine value={locationDraft.address} onChange={(event) => setLocationDraft((current) => ({ ...current, address: event.target.value }))} /></label>
            <Button variant="primary" type="submit" disabled={busy}>Create location</Button>
          </form>
        </Modal>
      ) : null}
      {modal === "invite" ? (
        <Modal title="Invite user" onClose={() => setModal("")}>
          <form className="admin-modal-form" onSubmit={onCreateInvite}>
            {error ? <p className="admin-modal-error" role="alert">{error}</p> : null}
            <label><span>Name</span><input {...textEntryProps("name")} required value={inviteDraft.name} onChange={(event) => setInviteDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span>Email</span><input {...textEntryProps("identifier")} required type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((current) => ({ ...current, email: event.target.value }))} /></label>
            <label><span>Role</span><select value={inviteDraft.role} onChange={(event) => setInviteDraft((current) => ({ ...current, role: event.target.value }))}><option value="mechanic">Mechanic</option><option value="office">Office</option><option value="surveillance">Surveillance</option><option value="admin">Admin</option></select></label>
            {inviteDraft.role === "admin" ? <div className="admin-inherited-access"><strong>All locations</strong><p>Admins automatically inherit access to every current and future location in this company.</p></div> : <LocationSelector locations={companyLocations} value={inviteLocationIds} onChange={setInviteLocationIds} requiredIds={selectedId ? [selectedId] : []} />}
            <Button variant="primary" type="submit" disabled={busy || (inviteDraft.role !== "admin" && !inviteLocationIds.length)}>{busy ? "Creating" : "Create invite"}</Button>
          </form>
        </Modal>
      ) : null}
      {modal === "inviteLink" ? (
        <Modal title={inviteDelivery?.status === "sent" ? "Invitation sent" : "Invitation created"} onClose={() => setModal("")}>
          <div className="admin-invite-result">
            <p>{inviteDelivery?.status === "sent" ? <>An invitation email was sent to <strong>{inviteLinkRecipient}</strong>. Keep this link as a backup until the invitation is accepted.</> : inviteDelivery?.status === "not_configured" ? <>Email delivery is not configured. Share this invitation link with <strong>{inviteLinkRecipient}</strong>.</> : <>The invitation was saved, but the email could not be sent. Share this link with <strong>{inviteLinkRecipient}</strong>.</>}</p>
            <code>{inviteUrl}</code>
            <Button icon={Copy01} onClick={onCopyInviteLink}>{inviteDelivery?.status === "sent" ? "Copy backup link" : "Copy link"}</Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export { Modal };
