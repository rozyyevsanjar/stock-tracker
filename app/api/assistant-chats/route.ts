import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDashboardDb } from "@/lib/mongodb";

export const runtime = "nodejs";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

type SavedChat = {
  _id?: ObjectId;
  clientId: string;
  createdAt: Date;
  messages: ChatMessage[];
  title: string;
  updatedAt: Date;
};

function clientIdFrom(request: Request) {
  return request.headers.get("x-assistant-client-id")?.trim() ?? "";
}

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

function serialize(chat: SavedChat) {
  return {
    id: chat._id?.toString(),
    createdAt: chat.createdAt.toISOString(),
    messages: chat.messages,
    title: chat.title,
    updatedAt: chat.updatedAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const clientId = clientIdFrom(request);
  if (!clientId) {
    return NextResponse.json({ chats: [] });
  }

  try {
    const db = await getDashboardDb();
    const chats = await db
      .collection<SavedChat>("assistant_chats")
      .find({ clientId })
      .sort({ updatedAt: -1 })
      .limit(30)
      .toArray();

    return NextResponse.json({ chats: chats.map(serialize) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat history is unavailable.";
    return NextResponse.json({ error: message, unavailable: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const clientId = clientIdFrom(request);
  if (!clientId) {
    return NextResponse.json({ error: "Missing assistant client id." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const messages = cleanMessages(record.messages);
  if (!messages.length) {
    return NextResponse.json({ error: "A chat needs at least one message." }, { status: 400 });
  }

  try {
    const db = await getDashboardDb();
    const now = new Date();
    const chat: SavedChat = {
      clientId,
      createdAt: now,
      messages,
      title: titleFrom(messages),
      updatedAt: now,
    };
    const result = await db.collection<SavedChat>("assistant_chats").insertOne(chat);

    return NextResponse.json({ chat: serialize({ ...chat, _id: result.insertedId }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat history is unavailable.";
    return NextResponse.json({ error: message, unavailable: true }, { status: 503 });
  }
}
