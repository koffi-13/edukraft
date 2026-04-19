// src/content/moduleRegistry.js
// Registry des modules de formation EduKraft

import { Colors } from '../theme';

export const MODULES = [
  {
    id: 'marketing_digital_local',
    title: 'Marketing Digital Local',
    description: 'Apprenez à promouvoir votre entreprise en ligne',
    duration: 120, // minutes
    xp: 100,
    color: Colors.teal,
    lessons: [
      {
        id: 0,
        title: 'Introduction au Marketing Digital',
        content: 'Le marketing digital englobe toutes les stratégies de marketing en ligne...',
        duration: 15,
        quiz: {
          questions: [
            {
              id: 1,
              question: 'Qu\'est-ce que le marketing digital ?',
              options: [
                'Marketing uniquement sur les réseaux sociaux',
                'Marketing utilisant les canaux numériques',
                'Marketing traditionnel',
                'Marketing par email seulement'
              ],
              correct: 1
            }
          ]
        }
      },
      {
        id: 1,
        title: 'Les Réseaux Sociaux',
        content: 'Les réseaux sociaux sont essentiels pour le marketing moderne...',
        duration: 20,
        quiz: {
          questions: [
            {
              id: 1,
              question: 'Quel réseau social est le plus populaire au Togo ?',
              options: ['Facebook', 'Twitter', 'LinkedIn', 'TikTok'],
              correct: 0
            }
          ]
        }
      }
    ]
  },
  {
    id: 'comptabilite_artisanale',
    title: 'Comptabilité Artisanale',
    description: 'Gestion financière de base pour artisans',
    duration: 90,
    xp: 80,
    color: Colors.amber,
    lessons: [
      {
        id: 0,
        title: 'Bases de la comptabilité',
        content: 'La comptabilité permet de suivre vos finances...',
        duration: 15,
        quiz: {
          questions: [
            {
              id: 1,
              question: 'Qu\'est-ce qu\'un bilan ?',
              options: [
                'Liste des clients',
                'Photo des stocks',
                'État financier du patrimoine',
                'Plan de marketing'
              ],
              correct: 2
            }
          ]
        }
      }
    ]
  }
];

// Fonctions utilitaires
export function getModuleById(moduleId) {
  return MODULES.find(module => module.id === moduleId);
}

export function getTotalXP() {
  return MODULES.reduce((total, module) => total + module.xp, 0);
}

export function getTotalDuration() {
  return MODULES.reduce((total, module) => total + module.duration, 0);
}

export function getLessonById(moduleId, lessonIndex) {
  const module = getModuleById(moduleId);
  return module?.lessons[lessonIndex];
}
