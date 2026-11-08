import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary, AppLoadingFallback } from "./app/AppErrorBoundary.jsx";
import { OnscreenKeyboardRoot } from "./components/layout/OnscreenKeyboardRoot.jsx";
import { repairGrantFromLocation } from "./features/customer-portal/customer-repair-api.js";
import { customerPortalGrantFromLocation } from "./features/customer-portal/customer-portal-grant.js";
import { AuthGate } from "./features/auth/AuthGate.jsx";
import "./typography.css";
import "./styles/mobile-usability.css";

const App = lazy(() => import("./app/App.jsx").then((module) => ({ default: module.App })));
const InviteAcceptPage = lazy(() => import("./features/admin/InviteAcceptPage.jsx").then((module) => ({ default: module.InviteAcceptPage })));
const ResetPasswordPage = lazy(() => import("./features/auth/ResetPasswordPage.jsx").then((module) => ({ default: module.ResetPasswordPage })));
const CustomerRepairPortalPage = lazy(() => import("./features/customer-portal/CustomerRepairPortalPage.jsx").then((module) => ({ default: module.CustomerRepairPortalPage })));
const CustomerPortalPage = lazy(() => import("./features/customer-portal/CustomerPortalPage.jsx").then((module) => ({ default: module.CustomerPortalPage })));

const search = new URLSearchParams(window.location.search);
const inviteToken = search.get("invite");
const resetPassword = search.get("resetPassword");
const resetToken = search.get("token");
const resetError = search.get("error");
const repairGrant = repairGrantFromLocation(window.location);
const customerGrant = customerPortalGrantFromLocation(window.location);

createRoot(document.getElementById("root")).render(
  <AppErrorBoundary>
    <OnscreenKeyboardRoot>
      <Suspense fallback={<AppLoadingFallback />}>
        {repairGrant ? (
          <CustomerRepairPortalPage key={repairGrant} grant={repairGrant} />
        ) : customerGrant ? (
          <CustomerPortalPage grant={customerGrant} />
        ) : resetPassword ? (
          <ResetPasswordPage token={resetToken} tokenError={resetError} />
        ) : inviteToken ? (
          <InviteAcceptPage token={inviteToken} />
        ) : (
          <AuthGate>
            {({ actor }) => <App actor={actor} />}
          </AuthGate>
        )}
      </Suspense>
    </OnscreenKeyboardRoot>
  </AppErrorBoundary>,
);
