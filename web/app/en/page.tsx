import { redirect } from "next/navigation";

// La landing en inglés se rehace después; por ahora, la versión en español.
export default function EnRedirect() {
  redirect("/");
}
