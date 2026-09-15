import { NextResponse } from "next/server";
import { appendEnrollmentRow } from "@/lib/google-sheets";

export async function GET() {
  const result = await appendEnrollmentRow(
    {
      admissionNumber: "TEST-PROD-001",
      studentName: "Prod Test Student",
      dob: "2015-01-01",
      gender: "male",
      grade: "G3",
      sectionName: "A",
      classTiming: "9:00 - 11:00",
      parentName: "Prod Test Parent",
      parentPhone: "+91 9999999999",
      parentEmail: "test@example.com",
      fatherName: "Prod Test Father",
      fatherPhone: "+91 9999999999",
      motherName: "Prod Test Mother",
      motherPhone: "+91 8888888888",
      address: "123 Test Street",
      previousSchool: "Test Previous School",
      curriculum: "IGCSE - Cambridge",
      penNumber: "PEN123",
      enrolledOn: new Date().toISOString(),
    },
    "TEST-DELETE-ME-PROD",
  );
  return NextResponse.json(result);
}
