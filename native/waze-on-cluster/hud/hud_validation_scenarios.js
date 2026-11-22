'use strict';
// 覆盖展示页场景、转向、车道边界及道路提示。仅供停车验证。
const scenarios = [
  {
    "id": "reference",
    "label": "Pencil 最新布局",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "bmw",
    "label": "BMW 道路事件",
    "input": {
      "type": "bmw",
      "reply": {
        "events": [
          {
            "type": "intersection",
            "value": {
              "distanceToDestination": 3150,
              "formattedDistance": {
                "distance": "147",
                "unit": {
                  "value": 4,
                  "name": "METER"
                },
                "rawDistance": 1
              },
              "description": {
                "elements": [
                  {
                    "type": "text",
                    "value": "进入示例道路"
                  }
                ]
              },
              "direction": {
                "value": 6,
                "name": "SLIGHT_RIGHT"
              }
            }
          }
        ]
      }
    }
  },
  {
    "id": "iap",
    "label": "iAP 路线事件",
    "input": {
      "type": "iap",
      "frames": [
        "4040002752010005000101000c000600000000000001d10008000700000dac0008000a000000fa"
      ]
    }
  },
  {
    "id": "lanes-2-left-straight",
    "label": "两车道 · 左直／右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left",
            "straight"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "right"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        }
      ]
    }
  },
  {
    "id": "lanes-3-right-straight",
    "label": "三车道 · 左／直／直右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": false,
          "leftBoundary": null
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "right",
            "straight"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "lanes-4-double-left",
    "label": "四车道 · 左／左／直／右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "left"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "right"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "lanes-4-shared",
    "label": "四车道 · 直左／直／直／直右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "straight",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "straight",
            "left"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight",
            "right"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "lanes-4-uturn",
    "label": "四车道 · 左掉头／左／直／右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "uturn",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left",
            "uturn"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "left"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "right"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        }
      ]
    }
  },
  {
    "id": "lanes-5-uturn",
    "label": "五车道 · 直掉头／左／直／直右／右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "uturn",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "straight",
            "uturn"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "left"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight",
            "right"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "right"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        }
      ]
    }
  },
  {
    "id": "lanes-6-shared",
    "label": "六车道 · 左／左直／直／直／直右／右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "straight",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": false,
          "leftBoundary": null
        },
        {
          "directions": [
            "left",
            "straight"
          ],
          "recommended": true,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight",
            "right"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "right"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        }
      ]
    }
  },
  {
    "id": "lanes-6-merge",
    "label": "六车道 · 左合流／直／直／直／直／右合流",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "merge_left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "merge_left"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "merge_right"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "lanes-3-left-right",
    "label": "三车道 · 左右／直／直右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left",
            "right"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": null
        },
        {
          "directions": [
            "straight",
            "right"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        }
      ]
    }
  },
  {
    "id": "lanes-4-three-way",
    "label": "四车道 · 三向共用／直／直／右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left",
            "straight",
            "right"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": null
        },
        {
          "directions": [
            "right"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        }
      ]
    }
  },
  {
    "id": "lanes-8-wide",
    "label": "八车道 · 左／左／左直／直／直／直右／右／右",
    "input": {
      "state": "navigating",
      "source": "车道演示数据",
      "currentRoad": "示例道路",
      "nextRoad": "前方路口",
      "exitLabel": "",
      "direction": "right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": false,
          "leftBoundary": null
        },
        {
          "directions": [
            "left"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "left",
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight",
            "right"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "right"
          ],
          "recommended": true,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "right"
          ],
          "recommended": true,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "rerouting",
    "label": "重新规划",
    "input": {
      "state": "rerouting"
    }
  },
  {
    "id": "arrived",
    "label": "到达目的地",
    "input": {
      "state": "arrived"
    }
  },
  {
    "id": "turn-left",
    "label": "转向 left",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-right",
    "label": "转向 right",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-straight",
    "label": "转向 straight",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "straight",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-slight_left",
    "label": "转向 slight_left",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "slight_left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-slight_right",
    "label": "转向 slight_right",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "slight_right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-sharp_left",
    "label": "转向 sharp_left",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "sharp_left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-sharp_right",
    "label": "转向 sharp_right",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "sharp_right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-uturn",
    "label": "转向 uturn",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "uturn",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-arrive",
    "label": "转向 arrive",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "arrive",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-roundabout",
    "label": "转向 roundabout",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "roundabout",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-straight_left",
    "label": "转向 straight_left",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "straight_left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-straight_right",
    "label": "转向 straight_right",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "straight_right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-left_right",
    "label": "转向 left_right",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left_right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-straight_uturn",
    "label": "转向 straight_uturn",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "straight_uturn",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-left_uturn",
    "label": "转向 left_uturn",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left_uturn",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-merge_left",
    "label": "转向 merge_left",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "merge_left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "turn-merge_right",
    "label": "转向 merge_right",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "merge_right",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "lanes-1",
    "label": "1 车道",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true,
          "leftBoundary": null
        }
      ]
    }
  },
  {
    "id": "lanes-7",
    "label": "7 车道",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true,
          "leftBoundary": null
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "distance-0",
    "label": "转向距离 0 米",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 0,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "distance-999",
    "label": "转向距离 999 米",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 999,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "distance-1000",
    "label": "转向距离 1000 米",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 1000,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "distance-12500",
    "label": "转向距离 12500 米",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 12500,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "missing-fields",
    "label": "缺少道路、距离、ETA 和车道",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "",
      "nextRoad": "",
      "exitLabel": "",
      "direction": null,
      "distanceM": null,
      "initialDistanceM": null,
      "remainingDistanceM": null,
      "remainingTimeS": null,
      "lanes": [],
      "instruction": ""
    }
  },
  {
    "id": "long-road",
    "label": "超长道路和出口文字",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线南大干线南大干线南大干线南大干线南大干线南大干线南大干线",
      "nextRoad": "南浦大道 石岗路南浦大道 石岗路南浦大道 石岗路南浦大道 石岗路南浦大道 石岗路南浦大道 石岗路南浦大道 石岗路南浦大道 石岗路",
      "exitLabel": "出口出口出口出口出口出口出口出口出口出口出口出口",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": true
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "solid"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false,
          "leftBoundary": "dashed"
        }
      ]
    }
  },
  {
    "id": "lanes-no-recommendation",
    "label": "无推荐车道、无边界数据",
    "input": {
      "state": "navigating",
      "source": "演示数据",
      "currentRoad": "南大干线",
      "nextRoad": "南浦大道 石岗路",
      "exitLabel": "出口",
      "direction": "left",
      "distanceM": 444,
      "initialDistanceM": 800,
      "remainingDistanceM": 12800,
      "remainingTimeS": 1080,
      "lanes": [
        {
          "directions": [
            "left"
          ],
          "recommended": false
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false
        },
        {
          "directions": [
            "straight"
          ],
          "recommended": false
        }
      ]
    }
  },
  {
    "id": "inactive",
    "label": "结束导航",
    "input": {
      "state": "inactive"
    }
  }
];

const reference = scenarios[0].input;
scenarios.splice(scenarios.length - 1, 0,
    { id: 'alerts-together', input: Object.assign({}, reference, {
        trafficLight: { color: 'red', seconds: 59 }, speedLimitKmh: 30
    }) },
    { id: 'alerts-green', input: Object.assign({}, reference, {
        trafficLight: { color: 'green', seconds: 41 }
    }) },
    { id: 'alerts-speed', input: Object.assign({}, reference, { speedLimitKmh: 30 }) });
module.exports = scenarios;
