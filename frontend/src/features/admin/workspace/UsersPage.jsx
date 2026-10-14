import {
  DotsVertical,
  Lock01,
  Mail01,
  MarkerPin01,
  Passcode,
  Shield03,
  Trash01,
  UserCheck01,
  UserX01,
} from "@untitledui/icons";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import { Fragment } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CheckpointCollection } from "../../../components/ui/CheckpointCollection.jsx";
import { useClientCheckpointPages } from "../../../components/ui/useClientCheckpointPages.js";
import { locationUserGroups } from "./admin-workspace-model.js";

function formatInviteExpiry(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function UserActionsMenu({ active, onManage, self, user }) {
  const passwordAction = user.role === "mechanic" ? "password" : "password-reset-email";
  const passwordLabel = user.role === "mechanic" ? "Set password" : "Send password reset";
  return (
    <MenuTrigger>
      <AriaButton className="admin-user-menu-trigger" aria-label={`Actions for ${user.name}`}>
        <DotsVertical />
      </AriaButton>
      <Popover className="admin-user-menu-popover" placement="bottom end">
        <Menu className="admin-user-menu" aria-label={`Actions for ${user.name}`}>
          <MenuItem className="admin-user-menu-item" onAction={() => onManage("locations", user)} textValue="Manage locations">
            <MarkerPin01 />
            <span>{user.role === "admin" ? "View location access" : "Manage locations"}</span>
          </MenuItem>
          <MenuItem className="admin-user-menu-item" isDisabled={self} onAction={() => onManage(passwordAction, user)} textValue={passwordLabel}>
            {user.role === "mechanic" ? <Lock01 /> : <Mail01 />}
            <span>{passwordLabel}</span>
          </MenuItem>
          <MenuItem className="admin-user-menu-item" isDisabled={!active} onAction={() => onManage("modules", user)} textValue="Module access">
            <Shield03 />
            <span>Module access</span>
          </MenuItem>
          {user.role === "mechanic" ? (
            <MenuItem
              className="admin-user-menu-item"
              isDisabled={!active}
              onAction={() => onManage("kiosk-pin", user)}
              textValue={user.kiosk_pin_set ? "Reset kiosk PIN" : "Set kiosk PIN"}
            >
              <Passcode />
              <span>{user.kiosk_pin_set ? "Reset kiosk PIN" : "Set kiosk PIN"}</span>
            </MenuItem>
          ) : null}
          <MenuItem className="admin-user-menu-item" isDisabled={self} onAction={() => onManage(active ? "deactivate" : "activate", user)} textValue={active ? "Deactivate user" : "Activate user"}>
            {active ? <UserX01 /> : <UserCheck01 />}
            <span>{active ? "Deactivate user" : "Activate user"}</span>
          </MenuItem>
          <MenuItem className="admin-user-menu-item danger" isDisabled={self} onAction={() => onManage("delete", user)} textValue="Delete user">
            <Trash01 />
            <span>Delete user</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function AdminUserRow({ actor, onManage, rowProps, user }) {
  const active = Boolean(user.active && user.membership_active);
  const self = user.id === actor.id;
  const passwordAction = user.role === "mechanic" ? "password" : "password-reset-email";
  const passwordLabel = user.role === "mechanic" ? "Set password" : "Send password reset";
  return (
    <div {...rowProps} className="admin-user-row">
      <span>
        <strong>{user.name}{self ? " (you)" : ""}</strong>
        <small>{user.username ? `@${user.username}` : user.email}</small>
      </span>
      <span className="admin-role">{user.role}</span>
      <span><span className={`admin-user-status ${active ? "active" : "inactive"}`}>{active ? "Active" : "Inactive"}</span></span>
      <span className="admin-kiosk-pin-cell">
        {user.role === "mechanic" ? (
          <span className={`admin-user-status ${user.kiosk_pin_set ? (user.kiosk_pin_requires_change ? "temporary" : "active") : "inactive"}`}>
            {user.kiosk_pin_set ? (user.kiosk_pin_requires_change ? "Temporary" : "Set") : "Not set"}
          </span>
        ) : <span className="admin-not-applicable">—</span>}
      </span>
      <span className="admin-user-actions admin-user-actions-desktop">
        <button type="button" title={`${user.role === "admin" ? "View" : "Manage"} locations for ${user.name}`} aria-label={`${user.role === "admin" ? "View" : "Manage"} locations for ${user.name}`} onClick={() => onManage("locations", user)}><MarkerPin01 /></button>
        <button type="button" title={self ? "Use your profile to change your own password" : `${passwordLabel} for ${user.name}`} aria-label={`${passwordLabel} for ${user.name}`} disabled={self} onClick={() => onManage(passwordAction, user)}>{user.role === "mechanic" ? <Lock01 /> : <Mail01 />}</button>
        <button type="button" title={!active ? "Activate this user before changing module access" : `Module access for ${user.name}`} aria-label={`Module access for ${user.name}`} disabled={!active} onClick={() => onManage("modules", user)}><Shield03 /></button>
        {user.role === "mechanic" ? (
          <button
            type="button"
            title={!active ? "Activate this mechanic before setting a kiosk PIN" : `${user.kiosk_pin_set ? "Reset" : "Set"} kiosk PIN for ${user.name}`}
            aria-label={`${user.kiosk_pin_set ? "Reset" : "Set"} kiosk PIN for ${user.name}`}
            disabled={!active}
            onClick={() => onManage("kiosk-pin", user)}
          >
            <Passcode />
          </button>
        ) : null}
        <button type="button" title={self ? "You cannot change your own status" : `${active ? "Deactivate" : "Activate"} ${user.name}`} aria-label={`${active ? "Deactivate" : "Activate"} ${user.name}`} disabled={self} onClick={() => onManage(active ? "deactivate" : "activate", user)}>
          {active ? <UserX01 /> : <UserCheck01 />}
        </button>
        <button type="button" className="danger" title={self ? "You cannot delete your own account" : `Delete ${user.name}`} aria-label={`Delete ${user.name}`} disabled={self} onClick={() => onManage("delete", user)}><Trash01 /></button>
      </span>
      <span className="admin-user-actions-mobile">
        <UserActionsMenu active={active} onManage={onManage} self={self} user={user} />
      </span>
    </div>
  );
}

function AdminUserGroup({ actor, description, entries, onManage, title }) {
  if (!entries.length) return null;
  return (
    <section className="admin-user-group" aria-label={`${title}, ${entries.length}`}>
      <header className="admin-user-group-header">
        <span><strong>{title}</strong><small>{description}</small></span>
        <span className="admin-user-group-count">{entries.length}</span>
      </header>
      {entries.map(({ item: user, key, rowProps }) => <AdminUserRow actor={actor} key={key} onManage={onManage} rowProps={rowProps} user={user} />)}
    </section>
  );
}

function groupUserEntries(entries) {
  const groups = locationUserGroups(entries.map(({ item }) => item));
  const byId = new Map(entries.map((entry) => [entry.item.id, entry]));
  return Object.fromEntries(Object.entries(groups).map(([name, users]) => (
    [name, users.map((user) => byId.get(user.id))]
  )));
}

export function UsersPage({ actor, detail, onInvite, onManage, onResend, resendingId }) {
  const pendingInvitations = detail.invitations.filter((invite) => invite.status === "pending");
  const resetKey = detail.location.id;
  const userQueue = useClientCheckpointPages(detail.users, { pageSize: 20, resetKey });
  const invitationQueue = useClientCheckpointPages(pendingInvitations, { pageSize: 10, resetKey });
  return (
    <section className="admin-panel">
      <header className="admin-panel-header"><h2>Users</h2><Button variant="primary" icon={Mail01} onClick={onInvite}>Invite user</Button></header>
      <CheckpointCollection
        ariaLabel="Users"
        label="users"
        pageSize={20}
        queue={userQueue}
        storageKey={`admin-location:${detail.location.id}:users`}
        renderItems={(entries) => {
          const pages = [...new Set(entries.map((entry) => entry.page))];
          return <div className="admin-users-table">
          <div className="admin-users-head"><span>User</span><span>Role</span><span>Account</span><span>Kiosk PIN</span><span>Actions</span></div>
          {detail.users.length ? (
            <>
              {pages.map((page) => {
                const groups = groupUserEntries(entries.filter((entry) => entry.page === page));
                return <Fragment key={page}>
                  <AdminUserGroup actor={actor} description="Access every location in this company" entries={groups.companyAdmins} onManage={onManage} title="Company-wide admins" />
                  <AdminUserGroup actor={actor} description="Active users explicitly assigned to this location" entries={groups.assignedActive} onManage={onManage} title="Assigned active" />
                  <AdminUserGroup actor={actor} description="Inactive account or location assignment" entries={groups.inactive} onManage={onManage} title="Inactive" />
                </Fragment>;
              })}
            </>
          ) : <div className="admin-empty">No users assigned.</div>}
          </div>;
        }}
      />
      {pendingInvitations.length ? (
        <div className="admin-pending">
          <strong>Pending invitations</strong>
          <CheckpointCollection
            ariaLabel="Pending invitations"
            label="invitations"
            pageSize={10}
            queue={invitationQueue}
            storageKey={`admin-location:${detail.location.id}:invitations`}
            renderItems={(entries) => <div className="admin-pending-list">
              {entries.map(({ item: invite, key, rowProps }) => (
                <div {...rowProps} className="admin-pending-row" key={key}>
                  <span>
                    <strong>{invite.email}</strong>
                    <small>{invite.role} · {invite.expired ? "Expired" : `Expires ${formatInviteExpiry(invite.expiresAt)}`}</small>
                  </span>
                  <Button icon={Mail01} onClick={() => onResend(invite)} disabled={Boolean(resendingId)}>
                    {resendingId === invite.id ? "Resending" : "Resend link"}
                  </Button>
                </div>
              ))}
            </div>}
          />
        </div>
      ) : null}
    </section>
  );
}
