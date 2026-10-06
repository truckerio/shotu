import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary, AppLoadingFallback } from "./app/AppErrorBoundary.jsx";
import { OnscreenKeyboardRoot } from "./components/layout/OnscreenKeyboardRoot.jsx";
import { customerPortalGrantFromLocation } from "./features/customer-portal/customer-portal-grant.js";
import { AuthGate } from "./features/auth/AuthGate.jsx";
import "./typography.css";

const App = lazy(() => import("./app/App.jsx").then((module) => ({ default: module.App })));
const InviteAcceptPage = lazy(() => import("./features/admin/InviteAcceptPage.jsx").then((module) => ({ default: module.InviteAcceptPage })));
const ResetPasswordPage = lazy(() => import("./features/auth/ResetPasswordPage.jsx").then((module) => ({ default: module.ResetPasswordPage })));
const CustomerPortalPage = lazy(() => import("./features/customer-portal/CustomerPortalPage.jsx").then((module) => ({ default: module.CustomerPortalPage })));

const search = new URLSearchParams(window.location.search);
const inviteToken = search.get("invite");
const resetPassword = search.get("resetPassword");
const resetToken = search.get("token");
const resetError = search.get("error");
const customerGrant = customerPortalGrantFromLocation(window.location);

createRoot(document.getElementById("root")).render(
  <AppErrorBoundary>
    <OnscreenKeyboardRoot>
      <Suspense fallback={<AppLoadingFallback />}>
        {customerGrant ? (
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
