FROM node:18-bullseye-slim

# تنزيل مكتبة openssl عشان Prisma يشتغل
RUN apt-get update && apt-get install -y openssl

# هنا التعديل: هنستخدم يوزر "node" اللي موجود أصلاً في الصورة دي
# وهديله الصلاحيات على فولدر الشغل
WORKDIR /app
RUN chown -R node:node /app

# التبديل لليوزر node
USER node

# ضبط مسارات العمل
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

# نسخ ملفات الحزم الأول
COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma/

# تسطيب المكاتب
RUN npm install

# نسخ باقي المشروع
COPY --chown=node:node . .

# فتح البورت المطلوب
EXPOSE 7860

# تشغيل السيرفر
CMD ["npm", "start"]