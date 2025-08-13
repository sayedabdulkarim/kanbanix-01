import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import path from 'path';

export async function GET() {
  try {
    const dbUrl = process.env.DATABASE_URL;
    
    // Get resolved path
    const resolvedPath = dbUrl ? dbUrl.replace('file:', '') : 'undefined';
    const absolutePath = path.resolve(process.cwd(), resolvedPath);
    
    // Try to create Prisma client
    const prisma = new PrismaClient();
    
    // Test query
    const userCount = await prisma.user.count();
    const projectCount = await prisma.project.count();
    
    await prisma.$disconnect();
    
    return NextResponse.json({
      success: true,
      dbUrl,
      resolvedPath,
      absolutePath,
      cwd: process.cwd(),
      userCount,
      projectCount,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      dbUrl: process.env.DATABASE_URL,
      cwd: process.cwd(),
    }, { status: 500 });
  }
}