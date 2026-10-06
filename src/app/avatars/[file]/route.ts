import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await params;
    if (!file.endsWith(".webp")) {
      return new NextResponse("Not found", { status: 404 });
    }
    const user = await withRls(RLS_SERVICE, (tx) =>
      tx.user.findFirst({
        where: { avatarUrl: `/avatars/${file}` },
        select: { avatarData: true },
      })
    );
    if (!user?.avatarData) {
      return new NextResponse("Not found", { status: 404 });
    }
    return new NextResponse(Buffer.from(user.avatarData), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}