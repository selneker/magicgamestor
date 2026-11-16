import { runTransitionOut, runReducedTransitionOut, runTransitionIn, TRANSITION_SAFETY_MS } from "@/lib/slush";

describe("TRANSITION_SAFETY_MS", () => {
  it("définit une durée de sécurité finie", () => {
    expect(TRANSITION_SAFETY_MS).toBeGreaterThan(0);
    expect(TRANSITION_SAFETY_MS).toBeLessThan(60000);
  });
});

function setupDOM() {
  document.body.innerHTML = `
    <div class="page-w"><div class="main-w">content</div></div>
    <div class="page-transition-el"></div>
    <div class="page-transition-el"></div>
    <div class="page-transition-el"></div>
  `;
}

function mockGsap() {
  const mockTimeline = {
    set: jest.fn().mockReturnThis(),
    to: jest.fn().mockReturnThis(),
  };
  const gsap = {
    timeline: jest.fn(() => mockTimeline),
    set: jest.fn(),
    killTweensOf: jest.fn(),
    utils: { shuffle: jest.fn((arr) => arr) },
  };
  window.gsap = gsap;
  window.ScrollTrigger = { refresh: jest.fn() };
  window.SplitText = {};
  window.CustomEase = {};
  window.scrollTo = jest.fn();
  return { gsap, mockTimeline };
}

describe("runTransitionOut — timer de sécurité (busy ne reste jamais bloqué)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setupDOM();
    mockGsap();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete window.gsap;
    delete window.ScrollTrigger;
    delete window.SplitText;
    delete window.CustomEase;
    document.body.innerHTML = "";
  });

  it("appelle done quand onComplete GSAP ne se déclenche pas", () => {
    const done = jest.fn();
    runTransitionOut(done);
    expect(done).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS - 1);
    expect(done).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("n'appelle pas done deux fois si GSAP appelle onComplete avant le timer", () => {
    const done = jest.fn();
    const { gsap: gsapMock } = mockGsap();
    runTransitionOut(done);
    // GSAP appelle onComplete normalement avant le timer de sécurité
    gsapMock.timeline.mock.calls[0][0].onComplete();
    expect(done).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("nettoie le wrapper du DOM quand le timer de sécurité se déclenche", () => {
    const done = jest.fn();
    runTransitionOut(done);
    expect(document.querySelector(".mgs-transition-wrapper")).not.toBeNull();
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS);
    expect(document.querySelector(".mgs-transition-wrapper")).toBeNull();
  });

  it("appelle window.scrollTo(0, 0) pour réinitialiser le scroll en sortie", () => {
    const done = jest.fn();
    runTransitionOut(done);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe("runReducedTransitionOut — timer de sécurité (busy ne reste jamais bloqué)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setupDOM();
    mockGsap();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete window.gsap;
    delete window.ScrollTrigger;
    delete window.SplitText;
    delete window.CustomEase;
    document.body.innerHTML = "";
  });

  it("appelle done quand onComplete GSAP ne se déclenche pas", () => {
    const done = jest.fn();
    runReducedTransitionOut(done);
    expect(done).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS - 1);
    expect(done).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("nettoie le wrapper du DOM quand le timer de sécurité se déclenche", () => {
    const done = jest.fn();
    runReducedTransitionOut(done);
    expect(document.querySelector(".mgs-transition-wrapper")).not.toBeNull();
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS);
    expect(document.querySelector(".mgs-transition-wrapper")).toBeNull();
  });

  it("n'appelle pas done deux fois si GSAP appelle onComplete avant le timer", () => {
    const done = jest.fn();
    const { gsap: gsapMock } = mockGsap();
    runReducedTransitionOut(done);
    gsapMock.timeline.mock.calls[0][0].onComplete();
    expect(done).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("runTransitionIn — timer de sécurité (busy libéré après l'intro)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setupDOM();
    mockGsap();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete window.gsap;
    delete window.ScrollTrigger;
    delete window.SplitText;
    delete window.CustomEase;
    document.body.innerHTML = "";
  });

  it("appelle onIntroEnd quand onComplete GSAP ne se déclenche pas", () => {
    const onIntroEnd = jest.fn();
    runTransitionIn(onIntroEnd);
    expect(onIntroEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS - 1);
    expect(onIntroEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onIntroEnd).toHaveBeenCalledTimes(1);
  });

  it("n'appelle pas onIntroEnd deux fois si GSAP appelle onComplete avant le timer", () => {
    const onIntroEnd = jest.fn();
    const { gsap: gsapMock } = mockGsap();
    runTransitionIn(onIntroEnd);
    gsapMock.timeline.mock.calls[0][0].onComplete();
    expect(onIntroEnd).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(TRANSITION_SAFETY_MS);
    expect(onIntroEnd).toHaveBeenCalledTimes(1);
  });
});
