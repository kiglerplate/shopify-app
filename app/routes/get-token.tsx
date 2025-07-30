import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "./../db.server"; // ודא שזה הנתיב הנכון

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Missing shop parameter" }, { status: 400 });
  }

  const authHeader = request.headers.get("x-internal-auth");
  if (authHeader !== process.env.INTERNAL_AUTH_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await prisma.session.findFirst({
    where: { shop },
  });

  if (!session || !session.accessToken) {
    return json({ error: "No access token found for this shop" }, { status: 404 });
  }

  return json({ accessToken: session.accessToken });
};
