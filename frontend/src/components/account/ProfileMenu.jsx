import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, Key01, LogOut01, UserCircle, Users01 } from "@untitledui/icons";
import { Button, Dialog, DialogTrigger, Popover, Separator } from "react-aria-components";
import { useKioskSession } from "../../features/kiosk/KioskSessionContext.jsx";
import { purgeMechanicWorkStorage } from "../../features/mechanic/progress/mechanic-work-storage.js";
import { authClient } from "../../lib/auth-client.js";
import { ChangePasswordDialog } from "./ChangePasswordDialog.jsx";
import { PasskeyManager } from "./PasskeyManager.jsx";
import { interfaceText } from "../../i18n/index.js";
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

function roleLabel(role, locale) {
  const key = ["admin", "mechanic", "surveillance", "office"].includes(role) ? `account.role.${role}` : "account.account";
  return interfaceText(locale, key);
}

export function ProfileMenu({ actor, compactOnPhone = false, mobileAction = false, mobileNav = false, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
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
          ? t("account.openingKiosk")
          : kioskSession.kioskSession
            ? t("account.switchMechanic")
            : t("account.openKiosk"),
        onAction: () => kioskSession.leaveForKiosk("switch"),
      });
    }
    actions.push(
      { id: "passkeys", Icon: UserCircle, label: t("account.managePasskeys"), onAction: () => setPasskeysOpen(true) },
      { id: "change-password", Icon: Key01, label: t("account.changePassword"), onAction: () => setChangePasswordOpen(true) },
      { id: "sign-out", Icon: LogOut01, label: t("account.signOut"), onAction: signOut },
    );
    return actions;
  }, [kioskSession, locale, signOut]);

  const accountMenu = (
    <Popover className="profile-menu-popover" placement={mobileNav ? "top end" : "bottom end"}>
      <Dialog className="profile-menu-dialog" aria-label={t("account.profileActions")}>
        {({ close }) => (
          <>
            <div className="profile-menu-summary">
              <UserCircle aria-hidden="true" />
              <span>
                <strong>{actor?.name || t("account.user")}</strong>
                <small>{actor?.email || roleLabel(actor?.role, locale)}</small>
              </span>
            </div>
            <Separator className="profile-menu-separator" />
            <div className="profile-menu-list" role="menu" aria-label={t("account.profileActions")}>
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
          <Button className="profile-menu-mobile-nav-trigger" aria-label={t("account.openProfileMenu")}>
            <UserCircle aria-hidden="true" />
            <span>{t("account.profile")}</span>
          </Button>
          {accountMenu}
        </DialogTrigger>
        </div>
        <ChangePasswordDialog isOpen={changePasswordOpen} onOpenChange={setChangePasswordOpen} locale={locale} />
        <PasskeyManager isOpen={passkeysOpen} onOpenChange={setPasskeysOpen} locale={locale} />
      </>
    );
  }

  if (mobileAction) {
    return (
      <>
        <div className="profile-menu profile-menu-mobile-action">
        <DialogTrigger>
          <Button className="profile-menu-mobile-action-trigger" aria-label={t("account.openProfileMenu")}>
            <UserCircle aria-hidden="true" />
          </Button>
          {accountMenu}
        </DialogTrigger>
        </div>
        <ChangePasswordDialog isOpen={changePasswordOpen} onOpenChange={setChangePasswordOpen} locale={locale} />
        <PasskeyManager isOpen={passkeysOpen} onOpenChange={setPasskeysOpen} locale={locale} />
      </>
    );
  }

  return (
    <>
      <div className={`profile-menu${compactOnPhone ? " profile-menu-with-phone-brand" : ""}`}>
        <DialogTrigger>
          <Button className="profile-menu-trigger" aria-label={t("account.openAccountMenu")}>
            <span className="profile-menu-initials" aria-hidden="true">{initials(actor?.name)}</span>
            <span className="profile-menu-identity">
              <strong>{actor?.name || t("account.user")}</strong>
              <small>{roleLabel(actor?.role, locale)}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </Button>
          {accountMenu}
        </DialogTrigger>
      </div>
      <ChangePasswordDialog isOpen={changePasswordOpen} onOpenChange={setChangePasswordOpen} locale={locale} />
      <PasskeyManager isOpen={passkeysOpen} onOpenChange={setPasskeysOpen} locale={locale} />
    </>
  );
}
