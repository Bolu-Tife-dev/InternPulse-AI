-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "githubUrl" TEXT,
    "portfolioUrl" TEXT,
    "location" TEXT,
    "timezone" TEXT,
    "isNigerianCitizen" BOOLEAN NOT NULL DEFAULT true,
    "workAuthorization" TEXT NOT NULL DEFAULT 'Remote contractor worldwide',
    "yearsOfExperience" REAL NOT NULL DEFAULT 0,
    "headline" TEXT,
    "summary" TEXT,
    "skillsJson" TEXT NOT NULL DEFAULT '[]',
    "projectsJson" TEXT NOT NULL DEFAULT '[]',
    "languagesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "extractedText" TEXT NOT NULL DEFAULT '',
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,
    "checksum" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "applyUrl" TEXT,
    "applyEmail" TEXT,
    "atsType" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "descriptionHtml" TEXT NOT NULL DEFAULT '',
    "salary" TEXT,
    "salaryCurrency" TEXT,
    "location" TEXT,
    "remotePolicy" TEXT NOT NULL DEFAULT 'REMOTE',
    "regionEligibility" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "regionConfidence" REAL NOT NULL DEFAULT 0,
    "regionNotes" TEXT NOT NULL DEFAULT '[]',
    "roleType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "domain" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "techTags" TEXT NOT NULL DEFAULT '[]',
    "matchedScore" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvalNote" TEXT,
    "publishedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "statusDetail" TEXT,
    "coverLetter" TEXT,
    "answersJson" TEXT NOT NULL DEFAULT '{}',
    "confirmationRef" TEXT,
    "screenshotPath" TEXT,
    "errorMessage" TEXT,
    "costEstimate" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT,
    "graphId" TEXT NOT NULL,
    "threadId" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "sender" TEXT NOT NULL DEFAULT '',
    "bodyPreview" TEXT NOT NULL DEFAULT '',
    "receivedAt" DATETIME NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "sentiment" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "confidence" REAL NOT NULL DEFAULT 0,
    "matchedJobId" TEXT,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "detail" TEXT NOT NULL DEFAULT '',
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "Document_profileId_kind_idx" ON "Document"("profileId", "kind");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_company_idx" ON "Job"("company");

-- CreateIndex
CREATE UNIQUE INDEX "Job_source_sourceId_key" ON "Job"("source", "sourceId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_createdAt_idx" ON "Application"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_graphId_key" ON "EmailMessage"("graphId");

-- CreateIndex
CREATE INDEX "EmailMessage_classification_idx" ON "EmailMessage"("classification");

-- CreateIndex
CREATE INDEX "EmailMessage_receivedAt_idx" ON "EmailMessage"("receivedAt");
