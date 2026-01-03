import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Get or create user settings (single user app)
    let settings = await prisma.userSettings.findFirst();
    
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          baseCurrency: "USD"
        }
      });
    }

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { baseCurrency } = body;

    // Get or create settings
    let settings = await prisma.userSettings.findFirst();
    
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: { baseCurrency: baseCurrency || "USD" }
      });
    } else {
      settings = await prisma.userSettings.update({
        where: { id: settings.id },
        data: { baseCurrency }
      });
    }

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to update settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
