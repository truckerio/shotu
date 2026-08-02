export const BLANK_LOCATION = { name: "", type: "yard", address: "" };
export const BLANK_INVITE = { name: "", email: "", role: "mechanic" };
export const BLANK_PASSWORD = { password: "", confirmation: "" };
export const HIDDEN_PASSWORDS = { password: false, confirmation: false };

export const DEFAULT_TEMPORARY_KIOSK_PIN = "0000";

export const BLANK_KIOSK_PIN = {
  pin: DEFAULT_TEMPORARY_KIOSK_PIN,
  confirmation: DEFAULT_TEMPORARY_KIOSK_PIN,
};

export function templateForm(template, location) {
  return {
    headerTitle: template?.header_title || `${location.name.toUpperCase()} WORKORDER`,
    brandTop: template?.brand_top || "PRO TEC",
    brandBottom: template?.brand_bottom || "REPAIR",
    warrantyText: template?.warranty_text || "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
    responsibilityText: template?.responsibility_text || "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
    authorizationText: template?.authorization_text || "I authorize the above repair to be completed along with necessary material(s).",
  };
}

export function userLocationIds(user, currentLocationId) {
  const assigned = user.locationIds || user.location_ids || [];
  return assigned.length ? assigned : currentLocationId ? [currentLocationId] : [];
}

export function locationUserGroups(users) {
  return users.reduce((groups, user) => {
    const active = Boolean(user.active && user.membership_active);
    if (!active) groups.inactive.push(user);
    else if (user.role === "admin") groups.companyAdmins.push(user);
    else groups.assignedActive.push(user);
    return groups;
  }, { companyAdmins: [], assignedActive: [], inactive: [] });
}
