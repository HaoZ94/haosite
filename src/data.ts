export type PublicationCategory = 'research' | 'clinical' | 'toolbox';

export interface Publication {
  readonly id: string;
  readonly title: string;
  readonly journal: string;
  readonly date: string;
  readonly year: number;
  readonly category: PublicationCategory;
  /** Publisher or DOI landing page supplied by the original site. */
  readonly doi: string;
  readonly pdf: string;
}

export const publications: readonly Publication[] = [
  {
    id: 'motor-prediction-2026',
    title: 'Motor-based prediction during preparation of hand movement modulates auditory processing in two distinct directions',
    journal: 'NeuroImage',
    date: 'January 2026',
    year: 2026,
    category: 'research',
    doi: 'https://doi.org/10.1016/j.neuroimage.2026.121744',
    pdf: './assets/papers/2026neuroimage.pdf',
  },
  {
    id: 'auditory-hallucinations-2024',
    title: 'Impaired motor-to-sensory transformation mediates auditory hallucinations',
    journal: 'PLoS Biology',
    date: 'October 2024',
    year: 2024,
    category: 'clinical',
    doi: 'https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.3002836',
    pdf: './assets/papers/journal.pbio.3002836.pdf',
  },
  {
    id: 'event-relations-2024',
    title: 'Electrophysiological hallmarks for event relations and event roles in working memory',
    journal: 'Frontiers in Neuroscience',
    date: 'January 2024',
    year: 2024,
    category: 'research',
    doi: 'https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2023.1282869/full',
    pdf: './assets/papers/fnins-17-1282869.pdf',
  },
  {
    id: 'sensory-features-2023',
    title: 'Segregation and integration of sensory features by flexible temporal characteristics of independent neural representations',
    journal: 'Cerebral Cortex',
    date: 'June 2023',
    year: 2023,
    category: 'research',
    doi: 'https://academic.oup.com/cercor/article/33/16/9542/7204411',
    pdf: './assets/papers/Segregation and integration of sensory features by flexible temporal characteristics of independent neural representations.pdf',
  },
  {
    id: 'corollary-discharge-2022',
    title: 'The generic inhibitory function of corollary discharge in motor intention: evidence from the modulation effects of speech preparation on the late components of auditory neural responses',
    journal: 'eNeuro',
    date: 'November 2022',
    year: 2022,
    category: 'research',
    doi: 'https://www.eneuro.org/content/9/6/eneuro.0309-22.2022',
    pdf: './assets/papers/The generic inhibitory function of corollary discharge in motor intention.pdf',
  },
  {
    id: 'auditory-perception-2021',
    title: 'Deficits in multi-scale top-down processes distorting auditory perception in schizophrenia',
    journal: 'Behavioural Brain Research',
    date: 'June 2021',
    year: 2021,
    category: 'clinical',
    doi: 'https://www.sciencedirect.com/science/article/abs/pii/S0166432821002990?via%3Dihub',
    pdf: './assets/papers/Deficits in multi-scale top-down processes distorting auditory perception in schizophrenia.pdf',
  },
  {
    id: 'efference-copy-2020',
    title: 'Corollary Discharge versus Efference Copy: distinct neural signals in speech preparation differentially modulate auditory responses',
    journal: 'Cerebral Cortex',
    date: 'June 2020',
    year: 2020,
    category: 'research',
    doi: 'https://doi.org/10.1093/cercor/bhaa154',
    pdf: './assets/papers/Corollary Discharge Versus Efference Copy.pdf',
  },
  {
    id: 'easyeeg-2018',
    title: 'Group-level multivariate analysis in EasyEEG Toolbox: examining the temporal dynamics using topographic responses',
    journal: 'Frontiers in Neuroscience',
    date: 'July 2018',
    year: 2018,
    category: 'toolbox',
    doi: 'https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2018.00468/full',
    pdf: './assets/papers/Group-Level Multivariate Analysis in EasyEEG Toolbox.pdf',
  },
];

export interface Resource {
  readonly id: string;
  readonly title: string;
  readonly kind: 'Pipeline' | 'Tutorial';
  readonly platform: string;
  readonly date: string;
  readonly description: string;
  readonly href: string;
  readonly image: string;
  readonly imageAlt: string;
}

export const resources: readonly Resource[] = [
  {
    id: 'seeg-preprocessing',
    title: 'sEEG data preprocessing',
    kind: 'Pipeline',
    platform: 'Python',
    date: 'March 2025',
    description: 'A walkthrough of stereoelectroencephalography (sEEG) preprocessing in Python. The second revision adds further analyses and resolves earlier issues.',
    href: './assets/resources/sEEG_preprocess_demo_v2_1.html',
    image: './assets/images/sEEG_wave.jpeg',
    imageAlt: 'Stereoelectroencephalography signal traces',
  },
  {
    id: 'seeg-localization',
    title: 'sEEG electrode localization',
    kind: 'Tutorial',
    platform: 'Brainstorm',
    date: 'May 2025',
    description: 'Fundamentals of locating sEEG electrodes on the cortex. The latest revision incorporates Brainstorm’s May 2025 update.',
    href: './assets/resources/brainstorm_tutorial/brainstorm_sEEG.html',
    image: './assets/images/sEEG_brain.png',
    imageAlt: 'Stereoelectroencephalography electrodes on a cortical surface',
  },
];

export const profile = {
  name: 'Hao Zhu',
  chineseName: '朱昊',
  role: 'Postdoctoral Fellow',
  institute: 'Brain and Mind Institute',
  department: 'Department of Linguistics and Modern Languages',
  university: 'The Chinese University of Hong Kong',
  email: 'haozhu@cuhk.edu.hk',
  emailHref: 'mailto:haozhu@cuhk.edu.hk',
  github: 'https://github.com/HaoZ94',
  x: 'https://x.com/haozhu26',
  cv: './assets/haozhu_cv.pdf',
  portrait: './assets/images/hao_profile.jpg',
  office: [
    '4/F Hui Yeung Shing Building',
    'Chinese University of Hong Kong',
    'Shatin, NT, Hong Kong SAR',
  ],
  mapUrl: 'https://maps.google.com/maps?width=100%25&height=240&hl=en&q=chinese%20university%20of%20hong%20kong+(CUHK)&t=&z=14&ie=UTF8&iwloc=B&output=embed',
  visitorCountUrl: 'https://abacus.jasoncameron.dev/hit/haosite/pageviews',
} as const;

export interface ResearchInterest {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
}

export const researchInterests: readonly ResearchInterest[] = [
  {
    title: 'Speech & Language',
    description: 'How the brain constructs, interprets, and produces language across timescales — from phonetic features to meaning in context.',
    icon: './assets/images/speech.svg',
  },
  {
    title: 'Motor–Sensory Transformation',
    description: 'The integration of sensory prediction and motor output during speech production, and the neural choreography that binds them.',
    icon: './assets/images/motorsensory.svg',
  },
  {
    title: 'Electrophysiology',
    description: 'Non-invasive and intracranial recordings (EEG, MEG, ECoG, sEEG) to probe brain activity at high spatiotemporal resolution.',
    icon: './assets/images/ephys.svg',
  },
  {
    title: 'Brain–Computer Interfaces',
    description: 'Decoding language directly from neural signals, with the goal of restoring communication for those who have lost it.',
    icon: './assets/images/bci.svg',
  },
];
