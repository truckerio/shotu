import React from "react";
import { ChevronDown, LogOut01, UserCircle, Users01 } from "@untitledui/icons";
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { useKioskSession } from "../../features/kiosk/KioskSessionContext.jsx";
import { authClient } from "../../lib/auth-client.js";
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

  async function signOut() {
    await authClient.signOut();
    window.location.replace("/");
  }

  const accountMenu = (
    <Popover className="profile-menu-popover" placement={mobileNav ? "top end" : "bottom end"}>
      <Menu className="profile-menu-list" aria-label="Profile actions">
        <MenuItem className="profile-menu-summary" textValue={actor?.name || "Profile"}>
          <UserCircle />
          <span>
            <strong>{actor?.name || "User"}</strong>
            <small>{actor?.email || roleLabel(actor?.role)}</small>
          </span>
        </MenuItem>
        <Separator />
        {kioskSession?.canSwitch ? (
          <MenuItem
            className="profile-menu-action"
            onAction={() => kioskSession.leaveForKiosk("switch")}
            textValue={kioskSession.kioskSession ? "Switch mechanic" : "Open kiosk"}
          >
            <Users01 />
            <span>
              {kioskSession.leaving
                ? "Opening kiosk..."
                : kioskSession.kioskSession
                  ? "Switch mechanic"
                  : "Open kiosk"}
            </span>
          </MenuItem>
        ) : null}
        <MenuItem className="profile-menu-action" onAction={signOut} textValue="Sign out">
          <LogOut01 />
          <span>Sign out</span>
        </MenuItem>
      </Menu>
    </Popover>
  );

  if (mobileNav) {
    return (
      <div className="profile-menu profile-menu-mobile-nav">
        <MenuTrigger>
          <Button className="profile-menu-mobile-nav-trigger" aria-label="Open profile menu">
            <UserCircle aria-hidden="true" />
            <span>Profile</span>
          </Button>
          {accountMenu}
        </MenuTrigger>
      </div>
    );
  }

  if (mobileAction) {
    return (
      <div className="profile-menu profile-menu-mobile-action">
        <MenuTrigger>
          <Button className="profile-menu-mobile-action-trigger" aria-label="Open profile menu">
            <UserCircle aria-hidden="true" />
          </Button>
          {accountMenu}
        </MenuTrigger>
      </div>
    );
  }

  return (
    <div className={`profile-menu${compactOnPhone ? " profile-menu-with-phone-brand" : ""}`}>
      <MenuTrigger>
        <Button className="profile-menu-trigger" aria-label="Open account menu">
          <span className="profile-menu-initials" aria-hidden="true">{initials(actor?.name)}</span>
          <span className="profile-menu-identity">
            <strong>{actor?.name || "User"}</strong>
            <small>{roleLabel(actor?.role)}</small>
          </span>
          <ChevronDown aria-hidden="true" />
        </Button>
        {accountMenu}
      </MenuTrigger>
    </div>
  );
}
