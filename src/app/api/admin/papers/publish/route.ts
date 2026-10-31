import { revalidateTag } from "next/cache";
import { z } from "zod";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { publishPaper } from "@/lib/papers/sync";

const Body = z.object({ paperId: z.string().regex(/^cpp-\d{4}-\d{2}-l[1-8]$/) });

/** Admin only: publish a paper that was imported as a draft. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { paperId } = Body.parse(await req.json());
    if (!(await publishPaper(paperId))) throw new HttpError(404, "试卷不存在");
    revalidateTag("papers", { expire: 0 });
    return Response.json({ id: paperId, status: "published" });
  } catch (err) {
    return errorResponse(err);
  }
}
