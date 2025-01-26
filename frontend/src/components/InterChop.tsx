import React, { useCallback, useState, useEffect } from 'react';
import styles from './InterChop.module.css';
import { Counter } from './Counter';
import { CounterProvider } from '../state/CounterState';
import { ChainSelector } from './ChainSelector';
import { CounterContract } from '../contract-interactions/counter/counterContract';

type FoodState = 'unprepared' | 'preparing' | 'prepared';

type FoodItem = {
  id: string;
  state: FoodState;
  prepProgress?: number;
}

type Counter = {
  type: 'cooking' | 'assembly';
  chainId: number;
  items: FoodItem[];
}

type CounterContractInfo = {
  isDeployed: boolean;
  address: string | null;
}

export const InterChop: React.FC = () => {
  const [stations, setCounters] = React.useState<Counter[]>([
    { type: 'cooking', chainId: 901, items: [] },
    { type: 'assembly', chainId: 902, items: [] },
  ]);
  const [pizzasServed, setPizzasServed] = useState(0);
  const [contractInfo, setContractInfo] = useState<Record<string, CounterContractInfo>>({
    cooking: { isDeployed: false, address: null },
    assembly: { isDeployed: false, address: null }
  });

  // Move checkContracts out of useEffect so we can call it directly
  const checkContracts = async () => {
    const info: Record<string, CounterContractInfo> = {};
    
    for (const station of stations) {
      const contract = new CounterContract(station.chainId);
      const isDeployed = await contract.isCounterContractDeployed();
      const address = isDeployed ? await contract.getCounterAddress() : null;
      
      info[station.type] = { isDeployed, address };
    }
    
    setContractInfo(info);
  };

  useEffect(() => {
    checkContracts();
  }, [stations]);

  const handleAssemble = useCallback(() => {
    setCounters(prev => {
      const newCounters = [...prev];
      const assemblyCounter = newCounters.find(s => s.type === 'assembly');
      // Allow new pizza if station is empty
      if (assemblyCounter && assemblyCounter.items.length === 0) {
        const newPizza = {
          id: Math.random().toString(),
          state: 'unprepared' as const,
          prepProgress: 0
        };
        assemblyCounter.items = [newPizza];
      }
      return newCounters;
    });
  }, []);

  const handleCook = () => {
    setCounters(prev => {
      const newCounters = [...prev];
      const cookingCounter = newCounters.find(s => s.type === 'cooking');
      const rawPizza = cookingCounter?.items.find(item => item.state === 'unprepared');
      if (rawPizza) {
        const itemIndex = cookingCounter!.items.indexOf(rawPizza);
        startCooking(cookingCounter!.items, itemIndex);
      }
      return newCounters;
    });
  };

  const startCooking = (items: FoodItem[], itemIndex: number) => {
    items[itemIndex] = { ...items[itemIndex], state: 'preparing', prepProgress: 0 };
    
    const cookingInterval = setInterval(() => {
      setCounters(prev => {
        const newCounters = [...prev];
        const cookingCounter = newCounters.find(s => s.type === 'cooking');
        const currentItem = cookingCounter!.items[itemIndex];

        if (!currentItem) {
          clearInterval(cookingInterval);
          return prev;
        }

        if (currentItem.prepProgress! >= 100) {
          clearInterval(cookingInterval);
          cookingCounter!.items[itemIndex] = {
            ...currentItem,
            state: 'prepared',
          };
        } else {
          cookingCounter!.items[itemIndex] = {
            ...currentItem,
            prepProgress: currentItem.prepProgress! + 20
          };
        }
        return newCounters;
      });
    }, 1000);
  };

  const handleTransfer = useCallback((fromCounterIndex: number, itemIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setCounters(prev => {
      const newCounters = [...prev];
      const fromCounter = newCounters[fromCounterIndex];
      const item = fromCounter.items[itemIndex];
      if (!item) return newCounters;

      // If it's a cooked pizza in cooking station, serve it directly
      if (fromCounter.type === 'cooking' && item.state === 'prepared') {
        fromCounter.items.splice(itemIndex, 1);
        setPizzasServed(prev => prev + 1);
        return newCounters;
      }

      // Otherwise handle normal transfers (only raw pizzas from assembly to cooking)
      const toCounterIndex = (fromCounterIndex + 1) % stations.length;
      const toCounter = newCounters[toCounterIndex];
      
      const canTransfer = (
        fromCounter.type === 'assembly' && 
        toCounter.type === 'cooking' && 
        item.state === 'unprepared'
      );

      if (canTransfer) {
        const [transferredItem] = fromCounter.items.splice(itemIndex, 1);
        toCounter.items.push(transferredItem);
      }
      return newCounters;
    });
  }, [stations.length]);

  return (
    <div className={styles.gameContainer}>
      <h1>Inter-Chop</h1>
      <div className={styles.scoreBoard}>
        Pizzas Served: {pizzasServed}
      </div>
      <div className={styles.stationsContainer}>
        {stations.map((station, index) => (
          <CookingCounter 
            key={index}
            station={station}
            contractInfo={contractInfo[station.type]}
            onAction={station.type === 'cooking' ? handleCook : handleAssemble}
            onTransfer={(itemIndex, e) => handleTransfer(index, itemIndex, e)}
            onContractDeployed={checkContracts}
          />
        ))}
      </div>
      
      <div className={styles.counterSection}>
        <ChainSelector />
      </div>
    </div>
  );
};

const CookingCounter: React.FC<{
  station: Counter;
  contractInfo: CounterContractInfo;
  onAction: () => void;
  onTransfer: (itemIndex: number, e: React.MouseEvent) => void;
  onContractDeployed: () => Promise<void>;
}> = ({ station, contractInfo, onAction, onTransfer, onContractDeployed }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  const handleCopyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 1000);
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      const contract = new CounterContract(station.chainId);
      await contract.deployCounterContract();
      await onContractDeployed();
    } catch (error) {
      console.error('Failed to deploy station:', error);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className={styles.station}>
      <h2>{station.type.toUpperCase()} STATION</h2>
      
      {!contractInfo.isDeployed ? (
        <div className={styles.deployContainer}>
          <p>Counter not deployed on Chain {station.chainId}</p>
          <button 
            className={`${styles.actionButton} ${styles.deployButton}`}
            onClick={handleDeploy}
            disabled={isDeploying}
          >
            {isDeploying ? 'Deploying...' : `Deploy ${station.type} Counter`}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.contractInfo}>
            <div>Chain ID: {station.chainId}</div>
            <div>Status: Deployed</div>
            {contractInfo.address && (
              <div className={styles.addressContainer}>
                <span className={styles.address}>
                  Contract: {contractInfo.address.slice(0, 6)}...{contractInfo.address.slice(-4)}
                </span>
                <button 
                  className={`${styles.copyButton} ${isCopied ? styles.copied : ''}`}
                  onClick={() => handleCopyAddress(contractInfo.address!)}
                  title="Copy full address"
                >
                  {isCopied ? "✓" : "📋"}
                </button>
              </div>
            )}
          </div>
          <button 
            className={styles.actionButton}
            onClick={onAction}
          >
            {station.type === 'cooking' ? 'Cook' : 'Assemble'}
          </button>
          <div className={styles.workarea}>
            {station.items.map((item, index) => (
              <div 
                key={item.id}
                className={styles.item}
                onClick={(e) => onTransfer(index, e)}
              >
                {item.state === 'unprepared' && 'Raw Pizza'}
                {item.state === 'preparing' && (
                  <>
                    Pizza Cooking
                    <div className={styles.progressBar}>
                      <div 
                        className={styles.progress} 
                        style={{width: `${item.prepProgress}%`}}
                      />
                    </div>
                  </>
                )}
                {item.state === 'prepared' && 'Cooked Pizza'}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}; 