import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { AuditAction, recordAudit } from "@/lib/audit";
import { errorResponse } from "@/lib/api";
import { RLS_SERVICE, withRls } from "@/lib/rls";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 512;

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ name: user.name, avatarUrl: user.avatarUrl });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();

    const form = await req.formData();
    const file = form.get("avatar");
    if (!(file instanceof File) || !file.size) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "No image uploaded." }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "Image must be JPG, PNG or WebP." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "Image must be 2 MB or smaller." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Re-encode with sharp: resizes, strips all metadata (EXIF/GPS) and any
    // embedded payloads, and normalizes output to WebP. This prevents
    // polyglot/EXIF-based attacks and guarantees a safe, sanitized file.
    let output: Buffer;
    try {
      output = await sharp(bytes, { limitInputPixels: 16_777_216 })
        .rotate()
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "Image could not be processed." }, { status: 400 });
    }

    const filename = `${user.id}-${randomUUID()}.webp`;
    const url = `/avatars/${filename}`;
    await withRls(RLS_SERVICE, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { avatarUrl: url, avatarData: new Uint8Array(output) } });
      await recordAudit(tx, {
        actorId: user.id,
        action: "PROFILE_PICTURE_UPDATED",
        target: `user:${user.id}`,
        metadata: { avatarUrl: url },
      });
    });

    return NextResponse.json({ avatarUrl: url });
  } catch (error) {
    return errorResponse(error);
  }
}