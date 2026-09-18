import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDashboardDb } from "@/lib/mongodb";

export const runtime = "nodejs";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

function cleanMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const role = record.role === "assistant" ? "assistant" : "user";
      const text = String(record.text ?? "").trim();
      return text ? { role, text } : null;
    })
    .filter((message): message is ChatMessage => Boolean(message))
    .slice(-60);
}

function titleFrom(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user")?.text ?? "New chat";
  return firstUserMessage.length > 54 ? `${firstUserMessage.slice(0, 54)}...` : firstUserMessage;
}

function objectId(value: string) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const _id = objectId(id);
  if (!_id) {
    return NextResponse.json({ error: "Invalid chat update request." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const messages = cleanMessages(record.messages);
  if (!messages.length) {
    return NextResponse.json({ error: "A chat needs at least one message." }, { status: 400 });
  }

  try {
    const db = await getDashboardDb();
    const result = await db.collection("assistant_chats").updateOne(
      { _id },
      {
        $set: {
          messages,
          title: titleFrom(messages),
          updatedAt: new Date(),
        },
      },
    );

    if (!result.matchedCount) {
      return NextResponse.json({ error: "Chat was not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat history is unavailable.";
    return NextResponse.json({ error: message, unavailable: true }, { status: 503 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const _id = objectId(id);
  if (!_id) {
    return NextResponse.json({ error: "Invalid chat delete request." }, { status: 400 });
  }

  try {
    const db = await getDashboardDb();
    await db.collection("assistant_chats").deleteOne({ _id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat history is unavailable.";
    return NextResponse.json({ error: message, unavailable: true }, { status: 503 });
  }
}
