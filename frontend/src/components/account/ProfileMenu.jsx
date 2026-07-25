import React from "react";
import { ChevronDown, LogOut01, UserCircle } from "@untitledui/icons";
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
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

export function ProfileMenu({ actor }) {
  async function signOut() {
    await authClient.signOut();
    window.location.replace("/");
  }

  return (
    <MenuTrigger>
      <Button className="profile-menu-trigger" aria-label="Open profile menu">
        <span className="profile-menu-initials" aria-hidden="true">{initials(actor?.name)}</span>
        <span className="profile-menu-identity">
          <strong>{actor?.name || "User"}</strong>
          <small>{roleLabel(actor?.role)}</small>
        </span>
        <ChevronDown aria-hidden="true" />
      </Button>
      <Popover className="profile-menu-popover" placement="bottom end">
        <Menu className="profile-menu-list" aria-label="Profile actions">
          <MenuItem className="profile-menu-summary" textValue={actor?.name || "Profile"}>
            <UserCircle />
            <span>
              <strong>{actor?.name || "User"}</strong>
              <small>{actor?.email || roleLabel(actor?.role)}</small>
            </span>
          </MenuItem>
          <Separator />
          <MenuItem className="profile-menu-action" onAction={signOut} textValue="Sign out">
            <LogOut01 />
            <span>Sign out</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

