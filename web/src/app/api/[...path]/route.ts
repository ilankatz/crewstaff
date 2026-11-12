import { dispatch } from "@/server/router";
import "@/server/api/auth";
import "@/server/api/people";
import "@/server/api/jobs";
import "@/server/api/field";
import "@/server/api/messages";
import "@/server/api/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) => dispatch(req);
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
