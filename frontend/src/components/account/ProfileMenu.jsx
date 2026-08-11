import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, Key01, LogOut01, UserCircle, Users01 } from "@untitledui/icons";
import { Button, Dialog, DialogTrigger, Popover, Separator } from "react-aria-components";
import { useKioskSession } from "../../features/kiosk/KioskSessionContext.jsx";
import { purgeMechanicWorkStorage } from "../../features/mechanic/progress/mechanic-work-storage.js";
import { authClient } from "../../lib/auth-client.js";
import { ChangePasswordDialog } from "./ChangePasswordDialog.jsx";
import { PasskeyManager } from "./PasskeyManager.jsx";
import "./profile-menu.css";

function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";
}

function roleLabel(role) {
  if (role === "surveillance") return "Surveillance";
  return role ? `${role[0].toUpperCase()}${role.slice(1)}` : "Account";
}

export function ProfileMenu({ actor, compactOnPhone = false, mobileAction = false, mobileNav = false }) {
  const kioskSession = useKioskSession();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [passkeysOpen, setPasskeysOpen] = useState(false);
  const signOut = useCallback(async () => {
    try {
      await authClient.signOut();
    } finally {
      purgeMechanicWorkStorage();
      window.location.replace("/");
    }
  }, []);

  const menuActions = useMemo(() => {
    const actions = [];
    if (kioskSession?.canSwitch) {
      actions.push({
        id: "kiosk",
        Icon: Users01,
        label: kioskSession.leaving
          ? "Opening kiosk..."
          : kioskSession.kioskSession
            ? "Switch mechanic"
            : "Open kiosk",
        onAction: () => kioskSession.leaveForKiosk("switch"),
      });
    }
    actions.push(
      { id: "passkeys", Icon: UserCircle, label: "Manage passkeys", onAction: () => setPasskeysOpen(true) },
      { id: "change-password", Icon: Key01, label: "Change password", onAction: () => setChangePasswordOpen(true) },
      { id: "sign-out", Icon: LogOut01, label: "Sign out", onAction: signOut },
    );
    return actions;
  }, [kioskSession, signOut]);

  const accountMenu = (
    <Popover className="profile-menu-popover" placement={mobileNav ? "top end" : "bottom end"}>
      <Dialog className="profile-menu-dialog" aria-label="Profile actions">
        {({ close }) => (
          <>
            <div className="profile-menu-summary">
              <UserCircle aria-hidden="true" />
              <span>
                <strong>{actor?.name || "User"}</strong>
                <small>{actor?.email || roleLabel(actor?.role)}</small>
              </span>
            </div>
            <Separator className="profile-menu-separator" />
            <div className="profile-menu-list" role="menu" aria-label="Profile actions">
              {menuActions.map((item) => {
                const Icon = item.Icon;
                return (
                  <button
                    key={item.id}
                    className="profile-menu-action"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      item.onAction();
                    }}
                  >
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Dialog>
    </Popover>
  );

  if (mobileNav) {
    return (
      <>
        <div className="profile-menu profile-menu-mobile-nav">
        <DialogTrigger>
          <Button className="profile-menu-mobile-nav-trigger" aria-label="Open profile menu">
            <UserCircle aria-hidden="true" />
            <span>Profile</span>
          </Button>
          {accountMenu}
        </DialogTrigger>
        </div>
        <ChangePasswordDialog isOpen={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
        <PasskeyManager isOpen={passkeysOpen} onOpenChange={setPasskeysOpen} />
      </>
    );
  }

  if (mobileAction) {
    return (
      <>
        <div className="profile-menu profile-menu-mobile-action">
        <DialogTrigger>
          <Button className="profile-menu-mobile-action-trigger" aria-label="Open profile menu">
            <UserCircle aria-hidden="true" />
          </Button>
          {accountMenu}
        </DialogTrigger>
        </div>
        <ChangePasswordDialog isOpen={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
        <PasskeyManager isOpen={passkeysOpen} onOpenChange={setPasskeysOpen} />
      </>
    );
  }

  return (
    <>
      <div className={`profile-menu${compactOnPhone ? " profile-menu-with-phone-brand" : ""}`}>
        <DialogTrigger>
          <Button className="profile-menu-trigger" aria-label="Open account menu">
            <span className="profile-menu-initials" aria-hidden="true">{initials(actor?.name)}</span>
            <span className="profile-menu-identity">
              <strong>{actor?.name || "User"}</strong>
              <small>{roleLabel(actor?.role)}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </Button>
          {accountMenu}
        </DialogTrigger>
      </div>
      <ChangePasswordDialog isOpen={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
      <PasskeyManager isOpen={passkeysOpen} onOpenChange={setPasskeysOpen} />
    </>
  );
}
