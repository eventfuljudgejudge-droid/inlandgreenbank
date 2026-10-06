ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "securityQuestion" TEXT;
ALTER TABLE "User" ADD COLUMN "securityAnswerHash" TEXT;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
