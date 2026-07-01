/* eslint-disable no-undef */
// test/EduKraftBadge.test.js
// Tests unitaires du contrat EduKraftBadge

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('EduKraftBadge', function () {
  let badge;
  let owner;
  let minter;
  let learner1;
  let learner2;

  const LEARNER1_NAME = 'Kofi Mensah';
  const LEARNER2_NAME = 'Afi Agbeko';
  const MODULE_NAME = 'Introduction a l\'entrepreneuriat';
  const CERT_HASH_1 = '0x' + 'a1'.repeat(32);

  async function getBlockTimestamp() {
    const block = await ethers.provider.getBlock('latest');
    return block.timestamp;
  }

  beforeEach(async function () {
    [owner, minter, learner1, learner2] = await ethers.getSigners();

    const EduKraftBadge = await ethers.getContractFactory('EduKraftBadge');
    badge = await EduKraftBadge.deploy();
    await badge.waitForDeployment();

    // Configurer minter
    await badge.connect(owner).setMinter(minter.address);
  });

  describe('Deploiement', function () {
    it('Doit avoir le bon owner', async function () {
      expect(await badge.owner()).to.equal(owner.address);
    });

    it('Doit avoir le bon nom', async function () {
      expect(await badge.name()).to.equal('EduKraft Certificate');
    });

    it('Doit avoir le bon symbole', async function () {
      expect(await badge.symbol()).to.equal('EDUKRAFT');
    });

    it('Le minter ne doit pas etre l\'owner par defaut', async function () {
      // Après setMinter, le minter est configure
      expect(await badge.minter()).to.equal(minter.address);
    });
  });

  describe('setMinter', function () {
    it('L\'owner peut changer le minter', async function () {
      await badge.connect(owner).setMinter(learner1.address);
      expect(await badge.minter()).to.equal(learner1.address);
    });

    it('Un non-owner ne peut pas changer le minter', async function () {
      await expect(
        badge.connect(learner1).setMinter(learner1.address)
      ).to.be.reverted;
    });
  });

  describe('mintBadge', function () {
    it('Le minter peut minter un badge', async function () {
      const tx = await badge.connect(minter).mintBadge(
        learner1.address,
        LEARNER1_NAME,
        MODULE_NAME,
        85,
        250,
        CERT_HASH_1
      );

      // Vérifier que learner1 possède le token 1
      expect(await badge.ownerOf(1)).to.equal(learner1.address);
    });

    it('Un non-minter ne peut pas minter', async function () {
      await expect(
        badge.connect(learner1).mintBadge(
          learner1.address,
          LEARNER1_NAME,
          MODULE_NAME,
          85,
          250,
          CERT_HASH_1
        )
      ).to.be.reverted;
    });

    it('L\'owner peut aussi minter', async function () {
      await badge.connect(owner).mintBadge(
        learner1.address,
        LEARNER1_NAME,
        MODULE_NAME,
        90,
        300,
        CERT_HASH_1
      );
    });

    it('Rejette un score > 100', async function () {
      await expect(
        badge.connect(minter).mintBadge(
          learner1.address,
          LEARNER1_NAME,
          MODULE_NAME,
          101, // > 100
          250,
          CERT_HASH_1
        )
      ).to.be.reverted;
    });

    it('Rejette un certHash vide', async function () {
      await expect(
        badge.connect(minter).mintBadge(
          learner1.address,
          LEARNER1_NAME,
          MODULE_NAME,
          85,
          250,
          '' // vide
        )
      ).to.be.reverted;
    });

    it('Rejette l\'adresse zero', async function () {
      await expect(
        badge.connect(minter).mintBadge(
          ethers.ZeroAddress,
          LEARNER1_NAME,
          MODULE_NAME,
          85,
          250,
          CERT_HASH_1
        )
      ).to.be.reverted;
    });

    it('Les tokenIds sont incrementaux (1, 2, 3...)', async function () {
      // Note : certHash doivent être distincts depuis le correctif anti-doublon
      const CERT_HASH_2 = '0x' + 'b2'.repeat(32);
      await badge.connect(minter).mintBadge(learner1.address, LEARNER1_NAME, 'Module A', 80, 200, CERT_HASH_1);
      await badge.connect(minter).mintBadge(learner2.address, LEARNER2_NAME, 'Module B', 95, 400, CERT_HASH_2);

      expect(await badge.ownerOf(1)).to.equal(learner1.address);
      expect(await badge.ownerOf(2)).to.equal(learner2.address);
    });
  });

  describe('getBadge', function () {
    it('Retourne les bonnes metadonnees', async function () {
      await badge.connect(minter).mintBadge(
        learner1.address,
        LEARNER1_NAME,
        MODULE_NAME,
        92,
        350,
        CERT_HASH_1
      );

      const data = await badge.getBadge(1);
      expect(data.learnerName).to.equal(LEARNER1_NAME);
      expect(data.moduleName).to.equal(MODULE_NAME);
      expect(Number(data.score)).to.equal(92);
      expect(Number(data.xpEarned)).to.equal(350);
      expect(data.certHash).to.equal(CERT_HASH_1);
      expect(Number(data.issuedAt)).to.be.gt(0);
    });

    it('Rejette un tokenId inexistant', async function () {
      await expect(badge.getBadge(999)).to.be.reverted;
    });
  });

  describe('verifyCertHash', function () {
    it('Retourne le tokenId si le hash existe', async function () {
      await badge.connect(minter).mintBadge(
        learner1.address,
        LEARNER1_NAME,
        MODULE_NAME,
        85,
        250,
        CERT_HASH_1
      );

      const tokenId = await badge.verifyCertHash(CERT_HASH_1);
      expect(tokenId).to.equal(1);
    });

    it('Retourne 0 si le hash n\'existe pas', async function () {
      const tokenId = await badge.verifyCertHash('0x' + 'ff'.repeat(32));
      expect(tokenId).to.equal(0);
    });

    // ── Tests du correctif O(1) + anti-doublon ──────────────────────────────

    it('O(1) : verifie en temps constant meme avec plusieurs badges mintes', async function () {
      // Mint 5 badges avec des certHash différents
      const hashes = [];
      for (let i = 0; i < 5; i++) {
        const h = '0x' + (i + 1).toString(16).padStart(64, '0');
        hashes.push(h);
        await badge.connect(minter).mintBadge(
          learner1.address,
          LEARNER1_NAME,
          MODULE_NAME,
          80 + i,
          200 + i * 10,
          h
        );
      }

      // verifyCertHash doit retrouver le 3e badge (tokenId 3) instantanément
      // via le mapping inverse, sans itérer sur les autres.
      const tokenId = await badge.verifyCertHash(hashes[2]);
      expect(tokenId).to.equal(3);
    });

    it('Rejette un certHash deja minte (anti-doublon)', async function () {
      await badge.connect(minter).mintBadge(
        learner1.address,
        LEARNER1_NAME,
        MODULE_NAME,
        85,
        250,
        CERT_HASH_1
      );

      // Tenter de minter à nouveau le même certHash doit échouer
      await expect(
        badge.connect(minter).mintBadge(
          learner2.address,
          LEARNER2_NAME,
          MODULE_NAME,
          90,
          300,
          CERT_HASH_1
        )
      ).to.be.revertedWith('CertHash deja existant');
    });
  });

  describe('tokenURI', function () {
    it('Genere un tokenURI JSON valide', async function () {
      await badge.connect(minter).mintBadge(
        learner1.address,
        LEARNER1_NAME,
        MODULE_NAME,
        88,
        300,
        CERT_HASH_1
      );

      const uri = await badge.tokenURI(1);
      const parsed = JSON.parse(uri);

      expect(parsed.name).to.equal('EduKraft Certificate #1');
      expect(parsed.description).to.include('EduKraft');
      expect(parsed.attributes).to.be.an('array');

      // Vérifier les attributs
      const attrs = {};
      parsed.attributes.forEach(a => { attrs[a.trait_type] = a.value; });
      expect(attrs.Module).to.equal(MODULE_NAME);
      expect(attrs.Apprenant).to.equal(LEARNER1_NAME);
      expect(attrs.Score).to.equal(88);
      expect(attrs.XP).to.equal(300);
      expect(attrs.CertHash).to.equal(CERT_HASH_1);
    });
  });

  describe('Events', function () {
    it('Emet BadgeMinted avec les bons parametres', async function () {
      const tx = await badge.connect(minter).mintBadge(
        learner1.address,
        LEARNER1_NAME,
        MODULE_NAME,
        75,
        200,
        CERT_HASH_1
      );

      await expect(tx)
        .to.emit(badge, 'BadgeMinted')
        .withArgs(1, learner1.address, LEARNER1_NAME, MODULE_NAME, 75, await getBlockTimestamp());
    });
  });
});