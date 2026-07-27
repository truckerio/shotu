import { RoleRouter } from "./routes/RoleRouter.jsx";
import "../styles.css";

export function App({ actor }) {
  return <RoleRouter actor={actor} />;
}
