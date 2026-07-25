import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./features/auth/AuthGate.jsx";
import "./typography.css";

const App = lazy(() => import("./app/App.jsx").then((module) => ({ default: module.App })));
const InviteAcceptPage = lazy(() => import("./features/admin/InviteAcceptPage.jsx").then((module) => ({ default: module.InviteAcceptPage })));

const inviteToken = new URLSearchParams(window.location.search).get("invite");

createRoot(document.getElementById("root")).render(
  <Suspense fallback={null}>
    {inviteToken ? (
      <InviteAcceptPage token={inviteToken} />
    ) : (
      <AuthGate>
        {({ actor }) => <App actor={actor} />}
      </AuthGate>
    )}
  </Suspense>,
);
