import { RoleRouter } from "./routes/RoleRouter.jsx";
import "../styles.css";
import "../styles/workspace-consistency.css";

export function App({ actor }) {
  return <RoleRouter actor={actor} />;
}
