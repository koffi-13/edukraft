// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EduKraftBadge
 * @notice Contrat ERC-721 pour les badges de certification EduKraft sur Polygon PoS.
 *         Chaque badge est un NFT unique minté quand un apprenant complète un module.
 *         Les métadonnées sont stockées on-chain (pas besoin d'IPFS pour le MVP).
 *
 * Déploiement cible : Polygon Mumbai (testnet) → Polygon Mainnet
 * Coût estimé : ~0.001 MATIC par mint (gaz très faible sur Polygon)
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EduKraftBadge is ERC721, ERC721URIStorage, Ownable {
    // ── Types ───────────────────────────────────────────────────────────────

    struct BadgeMetadata {
        string  learnerName;    // Nom de l'apprenant
        string  moduleName;     // Nom du module complété
        uint8   score;          // Score 0-100
        uint16  xpEarned;       // XP total gagnés dans le module
        uint256 issuedAt;       // Timestamp du mint
        string  certHash;       // SHA-256 de certification
    }

    // ── State ───────────────────────────────────────────────────────────────

    uint256 private _nextTokenId;
    mapping(uint256 => BadgeMetadata) public badges;

    // Compteur de badges par apprenant (par hash de learner)
    mapping(string => uint256) public learnerBadgeCount;

    // ── Index inverse certHash → tokenId (O(1) lookup) ──────────────────────
    // Corrige le O(n) linéaire de verifyCertHash. À l'échelle (10 000+ badges),
    // la boucle originale consommait tout le gas disponible. Ce mapping permet
    // une vérification en temps constant, indépendamment du nombre de badges.
    mapping(bytes32 => uint256) private _certHashToTokenId;

    // Adresse autorisée à minter (le backend API)
    address public minter;

    // ── Events ──────────────────────────────────────────────────────────────

    event BadgeMinted(
        uint256 indexed tokenId,
        address indexed owner,
        string  learnerName,
        string  moduleName,
        uint8   score,
        uint256 timestamp
    );

    // ── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyMinter() {
        require(msg.sender == minter || msg.sender == owner(), "Seul le minter autorise");
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────────

    constructor() ERC721("EduKraft Certificate", "EDUKRAFT") Ownable(msg.sender) {
        _nextTokenId = 1; // Commencer à 1 (tokenId 0 est invalide en ERC-721)
    }

    // ── Functions ───────────────────────────────────────────────────────────

    /**
     * @notice Définit l'adresse du minter (backend API)
     * @param _minter Adresse du serveur autorisé à minter
     */
    function setMinter(address _minter) external onlyOwner {
        require(_minter != address(0), "Adresse invalide");
        minter = _minter;
    }

    /**
     * @notice Mint un badge de certification pour un apprenant
     * @param to           Adresse du wallet de l'apprenant
     * @param learnerName  Nom de l'apprenant
     * @param moduleName   Nom du module
     * @param score        Score 0-100
     * @param xpEarned     XP gagnés
     * @param certHash     Hash SHA-256 de certification
     * @return tokenId     L'ID du token minté
     */
    function mintBadge(
        address to,
        string calldata learnerName,
        string calldata moduleName,
        uint8 score,
        uint16 xpEarned,
        string calldata certHash
    ) external onlyMinter returns (uint256 tokenId) {
        require(to != address(0), "Adresse destinataire invalide");
        require(score <= 100, "Score doit etre entre 0 et 100");
        require(bytes(certHash).length > 0, "CertHash requis");

        // ── Anti-doublon : un certHash ne peut être minté qu'une fois ──────
        // Sécurité additionnelle apportée par l'index inverse : sans cette
        // vérification, un bug backend pourrait minte deux badges pour le
        // même certHash, rendant verifyCertHash ambigu.
        bytes32 hashKey = keccak256(bytes(certHash));
        require(_certHashToTokenId[hashKey] == 0, "CertHash deja existant");

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        badges[tokenId] = BadgeMetadata({
            learnerName: learnerName,
            moduleName:  moduleName,
            score:       score,
            xpEarned:    xpEarned,
            issuedAt:    block.timestamp,
            certHash:    certHash
        });

        // Alimenter l'index inverse pour verifyCertHash O(1)
        _certHashToTokenId[hashKey] = tokenId;

        learnerBadgeCount[learnerName]++;

        // Token URI : JSON on-chain minimal (pas d'IPFS pour le MVP)
        string memory uri = _buildTokenURI(tokenId);
        _setTokenURI(tokenId, uri);

        emit BadgeMinted(tokenId, to, learnerName, moduleName, score, block.timestamp);
    }

    /**
     * @notice Récupère les métadonnées d'un badge
     */
    function getBadge(uint256 tokenId) external view returns (BadgeMetadata memory) {
        require(ownerOf(tokenId) != address(0), "Token inexistant");
        return badges[tokenId];
    }

    /**
     * @notice Vérifie si un certHash correspond à un token existant (O(1))
     * @dev Utilise le mapping inverse _certHashToTokenId. Complexité constante
     *      indépendamment du nombre de badges mintés. L'ancienne version O(n)
     *      itérait sur tous les tokens — à 10 000+ badges, elle dépassait la
     *      limite de gas d'un view call et devenait inutilisable.
     * @param certHash Le hash SHA-256 de certification à vérifier
     * @return tokenId Le token ID trouvé, ou 0 si non trouvé
     */
    function verifyCertHash(string calldata certHash) external view returns (uint256) {
        return _certHashToTokenId[keccak256(bytes(certHash))];
    }

    // ── Internal ────────────────────────────────────────────────────────────

    function _buildTokenURI(uint256 tokenId) internal view returns (string memory) {
        BadgeMetadata memory b = badges[tokenId];

        return string(abi.encodePacked(
            '{"name":"EduKraft Certificate #',
            _toString(tokenId),
            '","description":"Badge de certification EduKraft - Blockchain Polygon PoS",',
            '"attributes":[',
            '{"trait_type":"Module","value":"', b.moduleName, '"},',
            '{"trait_type":"Apprenant","value":"', b.learnerName, '"},',
            '{"trait_type":"Score","value":', _toString(b.score), '},',
            '{"trait_type":"XP","value":', _toString(b.xpEarned), '},',
            '{"trait_type":"CertHash","value":"', b.certHash, '"},',
            '{"trait_type":"IssuedAt","value":', _toString(b.issuedAt), '},',
            '{"display_type":"date","trait_type":"Mint Date","value":', _toString(b.issuedAt), '}',
            ']}'
        ));
    }

    // Override requis par Solidity quand on hérite de ERC721 et ERC721URIStorage
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ── Lib utilitaire ──────────────────────────────────────────────────────

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}