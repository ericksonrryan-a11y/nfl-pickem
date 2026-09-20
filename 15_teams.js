/* All 32 NFL clubs, keyed by ESPN's abbreviation so the slate builder's codes
   line up. Anything missing here is filled in automatically from the slate's
   own name/colour fields, so this map is a nicety rather than a dependency. */
var TEAMS = {
  ARI:{name:"Cardinals",primary:"#97233F",secondary:"#FFFFFF"},
  ATL:{name:"Falcons",primary:"#A71930",secondary:"#000000"},
  BAL:{name:"Ravens",primary:"#241773",secondary:"#9E7C0C"},
  BUF:{name:"Bills",primary:"#00338D",secondary:"#C60C30"},
  CAR:{name:"Panthers",primary:"#0085CA",secondary:"#101820"},
  CHI:{name:"Bears",primary:"#0B162A",secondary:"#C83803"},
  CIN:{name:"Bengals",primary:"#FB4F14",secondary:"#000000"},
  CLE:{name:"Browns",primary:"#311D00",secondary:"#FF3C00"},
  DAL:{name:"Cowboys",primary:"#041E42",secondary:"#869397"},
  DEN:{name:"Broncos",primary:"#FB4F14",secondary:"#002244"},
  DET:{name:"Lions",primary:"#0076B6",secondary:"#B0B7BC"},
  GB:{name:"Packers",primary:"#203731",secondary:"#FFB612"},
  HOU:{name:"Texans",primary:"#03202F",secondary:"#A71930"},
  IND:{name:"Colts",primary:"#002C5F",secondary:"#FFFFFF"},
  JAX:{name:"Jaguars",primary:"#006778",secondary:"#D7A22A"},
  KC:{name:"Chiefs",primary:"#E31837",secondary:"#FFB81C"},
  LV:{name:"Raiders",primary:"#000000",secondary:"#A5ACAF"},
  LAC:{name:"Chargers",primary:"#0080C6",secondary:"#FFC20E"},
  LAR:{name:"Rams",primary:"#003594",secondary:"#FFA300"},
  MIA:{name:"Dolphins",primary:"#008E97",secondary:"#FC4C02"},
  MIN:{name:"Vikings",primary:"#4F2683",secondary:"#FFC62F"},
  NE:{name:"Patriots",primary:"#002244",secondary:"#C60C30"},
  NO:{name:"Saints",primary:"#101820",secondary:"#D3BC8D"},
  NYG:{name:"Giants",primary:"#0B2265",secondary:"#A71930"},
  NYJ:{name:"Jets",primary:"#125740",secondary:"#FFFFFF"},
  PHI:{name:"Eagles",primary:"#004C54",secondary:"#A5ACAF"},
  PIT:{name:"Steelers",primary:"#101820",secondary:"#FFB612"},
  SF:{name:"49ers",primary:"#AA0000",secondary:"#B3995D"},
  SEA:{name:"Seahawks",primary:"#002244",secondary:"#69BE28"},
  TB:{name:"Buccaneers",primary:"#D50A0A",secondary:"#34302B"},
  TEN:{name:"Titans",primary:"#0C2340",secondary:"#4B92DB"},
  WSH:{name:"Commanders",primary:"#5A1414",secondary:"#FFB612"}
};

