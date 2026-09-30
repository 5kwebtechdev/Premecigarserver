import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────
// Catalog: the cigars that ship inside membership boxes.
// This is a memberships-only store — these products are never sold
// individually, they're the monthly contents of a plan.
// ─────────────────────────────────────────────────────────
const CIGARS = [
  {
    slug: 'royal-reserve',
    name: 'Royal Reserve',
    sku: 'PREME-RR',
    price: 18.0,
    description:
      'A refined, medium-full flagship. Ecuadorian Habano wrapper over Nicaraguan long-leaf — cedar, cocoa, and a clean, elegant finish.',
    image: 'https://images.unsplash.com/photo-1601001435957-74f0958a93c7?w=900&q=80',
    featured: true,
  },
  {
    slug: 'black-label',
    name: 'Black Label',
    sku: 'PREME-BL',
    price: 24.0,
    description:
      'The reserve-tier headliner. A darker, oily Maduro wrapper, aged fillers, and a rich espresso-and-dark-chocolate core.',
    image: 'https://images.unsplash.com/photo-1568149253762-4c0e7c1b1e6b?w=900&q=80',
    featured: true,
  },
  {
    slug: 'grand-toro',
    name: 'Grand Toro',
    sku: 'PREME-GT',
    price: 16.0,
    description:
      'A generous 6" x 52 toro built for a slow evening. Balanced, creamy, with toasted nuts and a touch of white pepper.',
    image: 'https://images.unsplash.com/photo-1613743983303-b3e89f8a2b80?w=900&q=80',
    featured: true,
  },
  {
    slug: 'heritage',
    name: 'Heritage',
    sku: 'PREME-HR',
    price: 20.0,
    description:
      'Our small-batch tribute blend. Rotated through PREME boxes seasonally — leather, dried fruit, and sweet cedar.',
    image: 'https://images.unsplash.com/photo-1544896478-d5b2d9a6a1a0?w=900&q=80',
    featured: false,
  },
];

// ─────────────────────────────────────────────────────────
// Events — the same dummy line-up shown in the site design
// (Home "Upcoming Events" band + the /events page).
// ─────────────────────────────────────────────────────────
const EVENTS = [
  {
    slug: 'preme-cigar-lounge-atlanta-sep',
    title: 'Preme Cigar Lounge',
    location: 'Atlanta, GA',
    description:
      'Join us for an exclusive evening of premium cigars, fine drinks, and great conversation with fellow Preme members. 7:00PM – 11:00PM · Members Only.',
    startAt: new Date('2026-09-12T19:00:00'),
    endAt: new Date('2026-09-12T23:00:00'),
    imageUrl: 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?w=1000&q=80',
    isPublished: true,
  },
  {
    slug: 'preme-lounge-night-orlando',
    title: 'PREME Lounge Night',
    location: 'PREME Lounge, Orlando, FL',
    description:
      'An evening of cigars & conversation. Relax, connect and enjoy premium cigars in an exclusive setting. 7:00PM – 11:00PM.',
    startAt: new Date('2026-09-30T19:00:00'),
    endAt: new Date('2026-09-30T23:00:00'),
    imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=1000&q=80',
    isPublished: true,
  },
  {
    slug: 'preme-cigar-lounge-atlanta-oct',
    title: 'Preme Cigar Lounge',
    location: 'Atlanta, GA',
    description:
      'Join us for an exclusive evening of premium cigars, fine drinks, and great conversation with fellow Preme members. 7:00PM – 11:00PM · Members Only.',
    startAt: new Date('2026-10-30T19:00:00'),
    endAt: new Date('2026-10-30T23:00:00'),
    imageUrl: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=1000&q=80',
    isPublished: true,
  },
  {
    slug: 'preme-cigar-lounge-atlanta-aug',
    title: 'Preme Cigar Lounge',
    location: 'Atlanta, GA',
    description:
      'A past members-only evening of premium cigars, fine drinks, and great conversation. 7:00PM – 11:00PM.',
    startAt: new Date('2026-08-30T19:00:00'),
    endAt: new Date('2026-08-30T23:00:00'),
    imageUrl: 'https://images.unsplash.com/photo-1559526324-593bc073d938?w=1000&q=80',
    isPublished: true,
  },
  {
    slug: 'preme-cigar-evening-chicago',
    title: 'Preme Cigar Evening',
    location: 'Chicago, IL',
    description: 'Memorable moments from our Chicago members evening — cigars, music, and good company.',
    startAt: new Date('2026-05-10T19:00:00'),
    endAt: new Date('2026-05-10T23:00:00'),
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1000&q=80',
    isPublished: true,
  },
  {
    slug: 'preme-cigar-evening-chicago-spring',
    title: 'Preme Cigar Evening',
    location: 'Chicago, IL',
    description: 'A past spring gathering of the Preme community over premium cigars and conversation.',
    startAt: new Date('2026-04-05T19:00:00'),
    endAt: new Date('2026-04-05T23:00:00'),
    imageUrl: 'https://images.unsplash.com/photo-1470091688026-6c5c6c1f8f31?w=1000&q=80',
    isPublished: true,
  },
];

async function upsertEvent(event) {
  const { slug, ...rest } = event;
  return prisma.event.upsert({
    where: { slug },
    update: rest,
    create: { slug, ...rest },
  });
}

async function upsertCigar(cigar, categoryId) {
  const product = await prisma.product.upsert({
    where: { slug: cigar.slug },
    update: {
      name: cigar.name,
      description: cigar.description,
      price: cigar.price,
      sku: cigar.sku,
      type: 'SUBSCRIPTION_ITEM',
      isFeatured: cigar.featured,
      isActive: true,
    },
    create: {
      name: cigar.name,
      slug: cigar.slug,
      description: cigar.description,
      price: cigar.price,
      sku: cigar.sku,
      type: 'SUBSCRIPTION_ITEM',
      isFeatured: cigar.featured,
      isActive: true,
      categories: { create: [{ categoryId }] },
    },
  });

  const hasImage = await prisma.productImage.findFirst({ where: { productId: product.id } });
  if (!hasImage) {
    await prisma.productImage.create({
      data: { productId: product.id, url: cigar.image, altText: cigar.name, sortOrder: 0 },
    });
  }

  await prisma.inventory.upsert({
    where: { productId: product.id },
    update: {},
    create: { productId: product.id, sku: cigar.sku, stockQty: 100, lowStockThreshold: 15 },
  });

  return product;
}

async function main() {
  // ── Admin login ──────────────────────────────────────────
  const adminPasswordHash = await bcrypt.hash('ChangeMe123!', 12);
  await prisma.user.upsert({
    where: { email: 'admin@spremecigar.com' },
    update: {},
    create: {
      email: 'admin@spremecigar.com',
      passwordHash: adminPasswordHash,
      firstName: 'S.PREME',
      lastName: 'Admin',
      role: 'ADMIN',
      emailVerified: true,
    },
  });

  // ── Catalog ──────────────────────────────────────────────
  const category = await prisma.category.upsert({
    where: { slug: 'premium-cigars' },
    update: {},
    create: { name: 'Premium Cigars', slug: 'premium-cigars' },
  });

  const bySlug = {};
  for (const cigar of CIGARS) {
    bySlug[cigar.slug] = await upsertCigar(cigar, category.id);
  }

  // ── Membership plans, each linked to the cigar it ships ──
  await prisma.membershipPlan.upsert({
    where: { slug: 'core-club' },
    update: {
      productId: bySlug['royal-reserve'].id,
      shipQuantity: 3,
      tagline: 'Curated premium cigars, every month.',
      imageUrl: 'https://images.unsplash.com/photo-1527427337751-fdca2f128ce5?w=900&q=80',
      benefits: [
        'Three curated premium cigars delivered monthly',
        'Member-only pricing on limited releases',
        'Early access to new blends',
        'Exclusive member event invitations',
      ],
    },
    create: {
      name: 'Core Club',
      slug: 'core-club',
      description: 'Entry premium membership with curated cigars and member perks.',
      price: 59,
      billingFrequency: 'MONTHLY',
      displayOrder: 1,
      productId: bySlug['royal-reserve'].id,
      shipQuantity: 3,
      tagline: 'Curated premium cigars, every month.',
      imageUrl: 'https://images.unsplash.com/photo-1527427337751-fdca2f128ce5?w=900&q=80',
      benefits: [
        'Three curated premium cigars delivered monthly',
        'Member-only pricing on limited releases',
        'Early access to new blends',
        'Exclusive member event invitations',
      ],
    },
  });

  await prisma.membershipPlan.upsert({
    where: { slug: 'reserve-club' },
    update: {
      productId: bySlug['black-label'].id,
      shipQuantity: 4,
      tagline: 'Elevated selection. Premium experience.',
      imageUrl: 'https://images.unsplash.com/photo-1514361892635-6b07e31e75f9?w=900&q=80',
      benefits: [
        'Four premium reserve-tier cigars delivered monthly',
        'Upgraded presentation and packaging',
        'Priority access to limited & aged releases',
        'All Core Club perks included',
      ],
    },
    create: {
      name: 'Reserve Club',
      slug: 'reserve-club',
      description: 'Higher-tier membership with more premium cigars and upgraded presentation.',
      price: 99,
      billingFrequency: 'MONTHLY',
      displayOrder: 2,
      productId: bySlug['black-label'].id,
      shipQuantity: 4,
      tagline: 'Elevated selection. Premium experience.',
      imageUrl: 'https://images.unsplash.com/photo-1514361892635-6b07e31e75f9?w=900&q=80',
      benefits: [
        'Four premium reserve-tier cigars delivered monthly',
        'Upgraded presentation and packaging',
        'Priority access to limited & aged releases',
        'All Core Club perks included',
      ],
    },
  });

  // ── Events (dummy line-up from the site design) ─────────
  for (const event of EVENTS) {
    await upsertEvent(event);
  }
  console.log(`Seeded ${EVENTS.length} events.`);

  console.log('Seed complete. Admin login: admin@spremecigar.com / ChangeMe123!');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
